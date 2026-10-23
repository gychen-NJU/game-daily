# 适配器契约：电脑操作能力从哪来

手机/PC 游戏的日常自动化只需要 6 个原语。任何 harness 只要能实现这 6 个，就能跑本家族的所有模块：

| 原语 | 语义 | 备注 |
|---|---|---|
| `shot` | 抓当前屏幕 → 文件 | 必须能拿到**物理像素**尺寸；看图由 agent 完成 |
| `move x y` | 移动光标 | 用来触发 hover（tooltip / 高亮） |
| `click x y` | 左键单击 | 坐标 = 屏幕物理像素，左上原点 |
| `key vk` | 按一次键 | `vk` 用 Windows 虚拟键码：F4=115、F2=113、ESC=27、Alt=18 |
| `type s` | 输入文本 | 仅在需要打字时用（本家族基本不用） |
| `fg hwnd` | 把窗口切到前台 | 管理员窗口 / 被别的窗口压住时必需 |

辅助原语：`list_windows`（找 hwnd）、`scroll`（翻卡片列表）。

---

## 1. 判定顺序（每次都先判定，别猜）

```
你的工具列表里有原生 computer-use 吗？
  ├─ 有 → 用【A. native】
  └─ 没有 → 是 DSH 会话吗（环境变量 DSH_HOME / 工具前缀 mcp__wincu__）？
        ├─ 是，且能看到 mcp__wincu__windows_computer_use_* → 用【B. wincu】
        ├─ 是，但看不到 → 先装插件（见下），装完重启 DSH 再自检；**装好前不要盲点**
        └─ 不是 DSH → 有 Chrome/系统级控制工具？没有就用【C. ps-helper】兜底
```

**判定信号（别靠端口/猜测）**

| harness | 信号 |
|---|---|
| DSH | `$env:DSH_HOME` 存在；工具名带 `mcp__wincu__` 前缀（装了 dsh-computer-use-win） |
| Claude Code | 工具列表里有 `computer`（或 `mcp__computer-use__*`） |
| Codex | 工具列表里有 computer-use 等价工具 |
| 其它 | 只有 shell → ps-helper |

---

## 2. 【A. native】harness 自带电脑操作

直接用它的截图 / 点击 / 按键工具。要点：

- **坐标同样是物理像素**；如果它给的是逻辑坐标（受 DPI 缩放影响），先做一次换算：`physical = logical × scale`。
- 截图后必须**自己看图**确认界面（本家族的 `expect` 判定就是给你看的）。
- 不需要装任何插件，也不需要 `ps-helper`。

---

## 3. 【B. wincu】DSH + `dsh-computer-use-win`

### 安装（DSH 首次使用）

```powershell
# 本机已验证的安装器（写 desktop profile 的 package.json + cordis.patch.yml）
node E:\GalaxyC\DSH\.diagnostics\dsh-restart-plugins\install-desktop.mjs add dsh-computer-use-win
# 然后重启 DSH 桌面端（Ctrl+C / 托盘退出 → 重新打开）
```

等价官方命令（DSH 未运行时）：`dsh plugin --profile desktop add dsh-computer-use-win`。

装好后的自检（三个都过才算可用）：

1. `mcp__wincu__windows_computer_use_health` → `ok:true`，`uiAutomation/screenshot/sendInput` 均 true；
2. `mcp__wincu__windows_computer_use_list_windows` → 能看到游戏窗口；
3. `mcp__wincu__windows_computer_use_screenshot`（带 `windowTitle`）→ 返回 PNG 路径，`read_image` 能看到界面。

### 常用工具映射

| 原语 | 工具 |
|---|---|
| shot | `windows_computer_use_screenshot`（**务必带 `windowTitle`**，否则截到的是当时的前台窗口，常常是 DSH 自己） |
| move | `windows_computer_use_move` |
| click | `windows_computer_use_click`（`dispatch:"auto"`；对管理员权限窗口会失败，见 §5） |
| key | `windows_computer_use_keypress`（`["f4"]` 形式） |
| fg | `windows_computer_use_activate_window` |
| list | `windows_computer_use_list_windows` |

### 已知坑（本机实证）

- **截图不带 `windowTitle`** = 截当前活动窗口；DSH 每次返回工具结果都会把自己带回前台，于是"截游戏"变成"截 DSH"。
- `activate_window` 能激活管理员权限窗口（如启动器/星铁），但**下一次工具结果会再次抢走前台**；所以"先激活、下一轮再点"一定点空——要么在同一轮里连续调用，要么改走 ps-helper 的原子序列。
- 对**管理员权限**窗口（星铁 `requireAdministrator`）点击会报 `COMPUTER_USE_INPUT_UNAVAILABLE: Windows rejected cursor positioning`（UIPI 拦截）→ 换 ps-helper。
- 截图返回里 `imageScale` 是缩放比：`screen = origin + preview / imageScale`。

---

## 4. 【C. ps-helper】兜底：PowerShell 提权输入助手

**能力**：截图（`shot.ps1`）+ 点击/移动/按键/切前台（`helper.ps1`，需一次 UAC）。**唯一能点管理员窗口**的路径。

### 启动（一次 UAC）

```powershell
Start-Process powershell -Verb RunAs -File "<module>\..\game-daily\scripts\helper.ps1" -WindowStyle Hidden
# 成功后：state/helper.pid 有 PID、heartbeat.txt 每隔 1s 更新
```

### 协议（cmd.txt / out.jsonl）

- `cmd.txt`：每行一条命令，首行用 `# 时间戳` 注释**强制重跑**（助手按文件内容变化触发）。
- 支持：`move x y`、`click x y`、`dclick x y`、`rclick x y`、`wheel n`、`activate <hwnd>`、`key <vk>`、`type <text>`、`start <exe>`、`kill <pid|name>`、`sleep <ms>`、`exit`。
- `out.jsonl`：每条命令一行 JSON `{ts,cmd,ok,err}`；`heartbeat.txt` 每秒刷新（判断存活）。

### 抢前台的标准原子序列（关键！）

```
key 18          # VK_MENU：给前台发一次 Alt，解除 Windows 前台锁
sleep 200
activate <hwnd>
sleep 700
move x y
sleep 350
click x y
```

直接 `SetForegroundWindow` 在"别的进程占着前台"时会返回 true 但**实际不生效**；`key 18` 先解除前台锁才可靠。这是本家族最重要的一条经验，别省。

### 前置校验（防止把点击送进别的程序）

执行前用一次 `GetForegroundWindow` 读标题，**标题不等于目标游戏就报错停手**，别硬点。`scripts/run-step.mjs --ps` 已内置该校验。

---

## 5. 权限与 UIPI

| 现象 | 原因 | 处理 |
|---|---|---|
| 点击报 `Windows rejected cursor positioning` / `SetCursorPos` 返回 False | 目标窗口由**管理员权限进程**持有，普通权限进程的输入被 UIPI 拦截 | 用 ps-helper（提权）；或让用户手动点这一步 |
| 前台切不过去（activate 返回 true 但没变） | Windows 前台锁 | `key 18` 后再 activate |
| 游戏窗口是 `requireAdministrator`（星铁） | 游戏自身要求管理员 | 同上；或从启动器启动（启动器会自提权，但点击仍要提权助手） |
| 弹了 UAC | `Start-Process -Verb RunAs` | 只弹一次；先讲清"点了能做什么"，被拒就降级为手动清单 |

**红线**：UAC 不允许连环弹；用户拒过一次后，改用「给命令/给清单让用户点」。

---

## 6. 坐标与 DPI

- 一律按**物理像素**记录与点击；截图文件可能是缩小版，换算：`screen = origin + previewPx / imageScale`。
- PowerShell 读取屏幕尺寸前必须 `SetProcessDPIAware()`，否则 DPI 200% 时返回 1707×1067（本机实测），点击全错位。
- 多显示器：以游戏窗口所在屏幕的尺寸为基准；`probe.mjs` 会输出该屏尺寸。

---

## 7. 失败模式速查

| 症状 | 最可能原因 | 下一步 |
|---|---|---|
| 截图全是 DSH 界面 | 没带 `windowTitle` / 前台被抢 | 带 `windowTitle`；或先 `activate` 再截 |
| 点了几次没反应 | 坐标偏了 / 前台被抢 / 窗口被遮挡 | 裁图放大核对坐标；走原子序列 |
| 点一下变成点到别处 | 前台不是游戏 | 执行前校验前台标题 |
| 游戏界面与 `expect` 不符 | 版本更新 / 弹窗挡住了 | **停手**，报告并问用户 |
| `probe` 报的屏幕尺寸比实际小 | DPI 不感知 | 升级 `probe.mjs`/`shot.ps1`（已内置 DPI 感知） |
