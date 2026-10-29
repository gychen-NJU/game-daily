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
| 同一坐标连点两次画面无变化；鼠标无反应但键盘有效 | 该游戏**过滤 ps-helper 的合成鼠标**（星铁进游戏后实测如此） | 改走 §8 用 computer-use 逐屏推（**computer-use 能正常接管，已实测跑通**） |

---

## 8. 升级路径：脚本点不动时，改用 computer-use 手动推（用户明确要求）

> **前提结论（2026-10-23 用户确认）**：星铁会过滤 `ps-helper` 的 `SetCursorPos`+`mouse_event` 合成点击，
> 但 **harness 的 `mcp__wincu__windows_computer_use_*` 可以正常接管星铁，此前已经跑通过**。
> 所以「ps-helper 点不动」≠「这个游戏不能自动化」——先换 computer-use 再下结论。
> 对星铁这类游戏，**computer-use 是首选适配器**，ps-helper 退化为"启停进程 + 发键盘"。

**判定**（满足任一条就切，别"再试三次"——连点只会触发风控/冷却，也浪费时间）：

- 同一坐标 `click` 两次、画面毫无变化；
- 鼠标点击无反应但**键盘有效**（星铁本机实测：`key 115` 能开指南、`key 27` 能关，合成鼠标点页签/按钮全无响应）；
- 探针/脚本报该窗口拒绝合成输入。

**做法**：把 computer-use 当"手"、把 `<m>-daily.json` 的 step 表当"导航"，一步一屏地推完剩下的步骤。每步固定五拍：

| 拍 | 工具 |
|---|---|
| 截图 | `windows_computer_use_screenshot`（**必带 `windowTitle`**） |
| 判读 | `read_image`，对照 step 的 `expect` |
| 执行 | `windows_computer_use_click`（`dispatch:"auto"`）/ `windows_computer_use_keypress`（`["f4"]` 形式） |
| 复检 | 再截一次，确认界面变了才继续 |
| 记录 | 这一步用了 computer-use → 写进模块 `state/` 与最终报告 |

**分支处理**

- 目标窗口是**管理员权限**（星铁本体 `requireAdministrator`）→ `click` 可能报 `COMPUTER_USE_INPUT_UNAVAILABLE`
  （UIPI 拦截）→ 先用 `keypress` 走键盘路径；键盘也走不通再回 §4 ps-helper。
- 常规 Windows 窗口（米哈游启动器、登录框）→ 用 UIA 更稳：`snapshot` → `find` → `invoke` / `set_value`，
  不必算像素。
- 截图里 `imageScale` 是缩放比：`screen = origin + preview / imageScale`。

**红线（与 §2.3 一致，不因换适配器而放松）**

- 付费礼包（"解锁…"）、删除、重置、清空 —— **绝不点**；星铁的付费按钮尤其危险。
- 界面与 `expect` 对不上、或出现看不懂的弹窗 → 停手，截图问用户，别猜。
- 只对目标游戏窗口发输入；每批点击前确认前台标题。

**为什么写进 skill**：用户 2026-10-23 明确要求 ——「星铁和崩坏三如果不能正常按脚本进行，请使用 harness 的电脑控制功能（computer-use）来帮我完成每日流程」。即：**脚本失效不等于当天放弃**，能用 computer-use 手动推的，就要推完并在报告里说明。

---

## 9. 定位优先：先找后点，落到每个适配器

> 规则全文（R1–R9）在 `../SKILL.md` §2.2；本节只回答"我知道该点了，可是那个点在哪儿、谁去点"。
> 一句话：**位置由 `scripts/locate.mjs` 给，坐标表只用来限定搜索区域，任何适配器都不许按坐标表直接点。**

### 9.1 为什么不再按坐标表点

旧链路是 `rx/ry × 屏幕尺寸 → 绝对坐标 → click`。它成立需要两个前提**同时**为真：

1. 当前分辨率 = 基准分辨率（模板库存的那台机器）；
2. 游戏 UI 在横竖两轴**同比缩放**。

米哈游系 UI 大多是**贴边锚定**（按钮跟边角走、底部导航贴下沿），宽高比一变相对位置就变：
16:10 量的 `(1630,1479)` 放到 16:9 上，页面整体会缩/移，按钮不再落在那儿。窗口化还会再小一圈
（标题栏/边框/黑边），DPI 缩放又叠一层。更典型的例子是崩坏3 的两种结算弹窗——`dialog.ok` 与
`popup.ok2` 高度差约 23 px，靠"记住 y"必然有一天点到空白。

**视觉定位对这类偏移不敏感**：模板只要在客户区里出现、`score` 够，`cx,cy` 就是当前分辨率下的真位置。
所以坐标表降级为"搜索先验"（给 `--region` 缩小范围、失败时排查），不再是点击依据（R4）。

### 9.2 统一流水线（与 §2–§4 的适配器无关）

```
① shot      实时截图（R1）                    ← 每批点击前重新抓，禁止复用旧图
② 认屏      对照 <m>-screens.md 的 expect（R2）← 文案不全 = 不在这个界面，别点
③ locate    跑 scripts/locate.mjs（R3）       ← found=false 或 score<阈值 = 不点
④ click     屏幕坐标 = capture.clientOrigin + (cx,cy)（R8）→ 用当前适配器去点
⑤ 复检      再截图 + 按 verify 判定（R6）     ← 记 score/scale/cx,cy + before/after
```

`locate` 的 `x,y` 是命中框左上、`cx,cy` 是中心；**点 `cx,cy`**。两者都相对**客户区**左上角。
把 `cx,cy` 变成点击用的屏幕坐标只差一步加法：`screenX = clientOrigin.x + cx`、`screenY = clientOrigin.y + cy`。

```powershell
node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" `
  --template "references\templates\<id>.png" `
  --threshold 0.72 `
  [--region x,y,w,h] `
  --json
```

输出：`{ok, found, score, scale, x, y, cx, cy, region, template, image, capture{method, window, clientOrigin}}`；
退出码 `0` 命中 / `2` 未找到（fail-closed）/ `1` 参数或文件错误。**由 `scripts/locate.mjs` 提供**
（底层定位引擎 `scripts/locate.ps1`）。

### 9.3 各适配器怎么落地

| 适配器 | 截图/认屏 | 定位 | 点击 | 注意 |
| --- | --- | --- | --- | --- |
| **A. native** | 自带截图工具 | 仍需 `locate`（R3 不分适配器） | 原生 click，坐标填 `clientOrigin + cx,cy` | 若原生工具吃**逻辑坐标**，先把物理坐标换算回逻辑（见 §2、§6），别把两套坐标混用 |
| **B. wincu** | `windows_computer_use_screenshot(windowTitle=…)` 只用于**认屏** | 用 `locate` 抓客户区、算分数（比人眼看图更可靠） | `windows_computer_use_click` 传 `clientOrigin + cx,cy`，`dispatch:"auto"` | `imageScale` 只用于"把预览图上的像素换回屏幕像素"（看图和量距），**不是**点击坐标来源；管理员窗口点击会被 UIPI 拦（§5）→ 换 ps-helper 或 keyboard |
| **C. ps-helper** | `shot.ps1` | 用 `locate` | 把 `clientOrigin + cx,cy` 写成 `cmd.txt` 里的 `click x y`，**仍走 §4 原子序列**（`key 18` → `activate` → sleep → `move` → `click`） | 唯一能点管理员窗口；`scripts/run-step.mjs --ps` 会按先验坐标直接点 → **违反 R4，日常只用它演练/探查**，不发真实点击 |
| **computer-use 手推（§8）** | `screenshot` + `read_image` | 优先 `locate`；定位不可用时允许"读图给坐标"，但**必须**同时留实时截图、写明依据、并在报告标注哪几步是手推 | `click` / `keypress` | 见 §9.4 的窄例外；手推也不能"凭记忆点像素" |

三个要点：

- **认屏和定位是两件事**，都不能省：截图看着对（R2）不等于控件找到了（R3）；模板命中了（R3）
  也不代表在预期界面（可能串到别的页的相似按钮）——所以顺序永远是 先认屏、再定位。
- **`--region` 从哪来**：`scripts/layout.mjs resolve`（锚点模型）或 `coords.mjs resolve`（先验）；
  同形页由 `references/templates/regions.json` 的 `pad` 覆盖默认 ±320（`run-step.mjs` 的 `layoutRegion()` 读）。
  `--region` 是**消歧手段**（收窄窗口、抬高 uniqueness），不是"降级成盲点"：窗内找不到照样 exit 2。
  拿不准就不带，全客户区搜索。
- **窗口客户区是唯一坐标系（R8）**：全屏 2560×1600、窗口化、1920×1080、2160×1440、3440×1440
  都成立；不要把整屏尺寸当客户区尺寸，也不要把 `capture.clientOrigin` 漏加。

### 9.4 唯一允许"没有 locate 分数"的情况（窄例外，必须留证）

只有下面两种情形可以改用"看图取坐标"，且必须**同时**满足列出的全部附加条件，否则停手：

1. `locate` 对该窗口不可用（抓图失败 / 报错 exit 1），或该 id 在**所有外观变体**（`templates/index.json`）里都缺失；
2. 附加条件：① 点是**本流程明确写出的目标**，不是"试试看"；② 点前点后各一张实时截图并存
   `state/shots/`；③ 坐标来源写进 `state/runs/`（"读图目测，非模板命中"）；④ 报告里注明哪几步；
   ⑤ 同一目标只点一次，点完没变化就停（R7），不重试点。

**反例（不允许）**：模板没命中 → "那我按坐标表点一下"。这条正是本协议要消灭的行为。

### 9.5 失败与停手（与 §7 一起看）

| 现象 | 判定 | 处理 |
| --- | --- | --- |
| `locate` exit 2 / `found=false` | 未找到 | 先验界面正确（R2）；收紧 `--region` 重试**一次**；仍失败 → 停手（`onMismatch: stop` 优先） |
| `found=true` 但 `score < 0.72` | 低置信 | **不点**（R3/R7）；可收紧区域重试一次；仍低 → 停手并报 `score` |
| exit 1 | 参数/模板路径错误 | 修命令；不要当"没找到"处理 |
| 命中框落在并排的相似按钮上 | 串模板 | 用 `--region` 限定到正确区域；仍串 → 报模板问题（`calibration.md` §6） |
| 单模板在另一种弹窗外观上分数偏低 | 外观变体没登记 | 查 `templates/index.json`，把另一种 png 挂成别名（实测 0.579 → 1.0），别急着重截模板 |
| 同形按钮命中错行 / `ambiguous=true`（同页像素级同形） | 缺消歧手段 | 先看是否"任意一行都行"：是 → `regions.json` 紧搜索窗（`pad [半宽x,半宽y]`，单位客户区像素）；要指定某行 → R9 锚点**全屏搜** + `anchors.json` `offset×scale`；缺条目 → 停手补表 |
| 紧搜索窗后仍 `ambiguous` | 窗还没收到只含一行 | 减小 `pad`（如 y 收到 ±70 只含首行，实测 1.0/0.0028 → 0.9995/0.6442 exit 0）；仍不行 → 停手补 `pad` 或改锚点 |
| 客户区尺寸与 `coords.local.json` 的 `screen` 不符 | R5 未校准 | 先验弃用（不影响定位，只是搜索范围变大） |
| 窗口不可见 / 被遮挡 / 前台被抢 | R7 | 先置前并**重新抓图重定位**，不得复用抢前台前的命中框 |
| 模板缺失（含 `index.json` 未登记、`anchors.json` 无条目、同形页 `regions.json` 无 `pad`） | 该步不可执行 | 停手报告，请模块作者补 png / 别名 / 锚点条目 / `pad`；不许退回坐标点击 |

### 9.6 证据（R6）

| 路径 | 内容 |
| --- | --- |
| `state/shots/<date>/<step>-<n>-before.png` | 点击前实时截图 |
| `state/shots/<date>/<step>-<n>-after.png` | 点击后实时截图 |
| `state/runs/<date>.json` | `{step, n, id, template, found, score, scale, cx, cy, screenClick:{x,y}, verify, ts}` 追加一条 |

没有这三样，无法判断"是没找到、点空了、还是点了但界面没变"——而这三种的处理方式完全不同。

### 9.7 三个脚本的分工（都按契约引用，实现见各自文件）

| 脚本 | 用途 | 命令要点 | 输出 |
| --- | --- | --- | --- |
| `scripts/run-step.mjs` | **流程级演练/执行（推荐入口）** | `--locate`（逐步截图→定位→过阈值才点）/ `--probe`（只截图+定位、绝不点击）/ `--anchor-only`（只走锚点排障）/ `--threshold 0.72`；同形页窗由 `templates/regions.json` 的 `pad` 收窄 | exit：`--locate` **0 全过 / 3 有步失败（已停，未点）**；`--probe` 0 全过 / 2 任一步未命中 |
| `scripts/locate.mjs`（+ `locate.ps1`） | **给点击位置**（R3 的唯一来源） | `--window <标题> --template <png> [--region x,y,w,h] --threshold 0.72 --json`；同一 id 多外观先读 `templates/index.json`；`--image` 形式只作离线排查（无 `clientOrigin`，不能换算屏幕坐标） | `found/score/scale/x/y/cx/cy/capture`；exit 0/2/1 |
| `scripts/layout.mjs` | 给**搜索区域**（锚点先验） | `resolve --layout <json> --screen <客户区WxH> --item <id>\|--all --json` | `id/x/y/screen/scale/anchor/offset/scaleMode/clamped` |
| `scripts/coords.mjs` | 旧接口：先验/排查 | `resolve <id> --game <g> --screen <客户区WxH> --json` | `{id, x, y, source(local\|relative\|absolute(legacy)), note}` |

> `coords.mjs` 的 `(x,y)` **永远不是点击坐标**；它只帮你理解"大概在哪"、或定位失败时对照排查。

**定位优先级（手工执行与 `run-step --locate/--probe` 一致）**：① 直接模板（`index.json` 里该 id 的全部变体，
先验只用来缩 `--region`；同形页的窗由 `regions.json` 的 `pad` 收窄）→ ② 锚点模板**全屏**搜索 +
`anchors.json` 的 `(dx,dy) × scale` → ③ 都失败 → 停手，**不退回坐标点击**。锚点必须全屏搜：它离目标约 402 px，
拿目标先验做 `--region` 会把锚点切掉。
