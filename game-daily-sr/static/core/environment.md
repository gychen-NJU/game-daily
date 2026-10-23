# 环境自检：这台机器上，谁来"看屏幕、点鼠标"

> 目标：**不要默认自己有能力**。先探测，再决定装插件 / 换适配器 / 请用户配合。

## 1. 先跑一次探测

```powershell
node ..\game-daily\scripts\probe.mjs --game sr --pretty
```

输出里看四项：

| 字段 | 含义 | 不对时怎么办 |
|---|---|---|
| `screen` | 物理分辨率（本机 2560×1600） | 与 `references/sr-coords.json` 的 base 不同 → 必须校准 |
| `processes.launcher` / `processes.game` | HYP / StarRail 进程 | 没开 → 先走启动链（`runbook-sr.md` §1） |
| `helper` | 提权助手是否在跑（`state/helper.pid` + 心跳） | ps-helper 路线需要它；见 §4 |
| `adapterHints` | 本会话探测到的工具线索 | 用来选适配器 |

## 2. 三个适配器：怎么选

| 环境 | 用什么 | 判据 |
|---|---|---|
| **DSH** | `wincu` | 会话里有 `mcp__wincu__windows_computer_use_screenshot / click / keypress / activate_window / list_windows` |
| **Claude Code / 其它自带 computer-use 的 harness** | `native` | 会话里有截屏+点击+键盘的等价工具（名称各异） |
| **纯 shell（Codex headless、普通 pwsh）** | `ps-helper` | 只有 shell；靠 `scripts/shot.ps1` + `scripts/helper.ps1` |

判定顺序**从上到下**，命中即停。三者可以混用（例如 wincu 截图 + ps-helper 点管理员窗口），但**同一次点击只能有一个来源**，否则会点两下。

## 3. DSH：需要装插件（只装一次）

```powershell
node E:\GalaxyC\DSH\.diagnostics\dsh-restart-plugins\install-desktop.mjs add dsh-computer-use-win
```

- 装完**必须重启 DSH Desktop**，插件才会以 MCP server 形式出现（工具前缀 `mcp__wincu__`）。
- 本机现状（2026-10-22 起）：desktop profile 已装 `dsh-computer-use-win@0.5.0`，工具已可用 → **先验证再谈安装**。
- 验证：调用 `mcp__wincu__windows_computer_use_health`，`ok:true` 即通；再 `..._list_windows` 看能否列出「崩坏：星穹铁道」。

> DSH 上装插件的坑：安装时若报 `atomic-write: timed out waiting for the writer lock`，看 `package.json.lock` 里的 PID 是否为存活的 DSH 主进程——是则备份后删锁重试。

## 4. 纯 shell：PowerShell 提权助手（ps-helper）

**为什么需要提权**：星铁是 `requireAdministrator`，米哈游启动器会自提权成管理员；普通权限进程的 `SetCursorPos` / `SendInput` 会被 **UIPI** 拦掉（报错 `Windows rejected cursor positioning`，或返回 False + err 203）。所以点击必须由**以管理员运行**的助手进程发出。

```powershell
# 只在用户明确同意后执行（会弹一次 UAC，且只弹这一次）
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','<abs>\game-daily\scripts\helper.ps1','-StateDir','<abs>\game-daily-sr\state'
```

- 助手常驻，读 `state/cmd.txt`（每行一条命令、首行 `# ts` 强制重跑），结果写 `state/out.jsonl`，心跳 `state/heartbeat.txt`，pid `state/helper.pid`。
- 命令集：`shot` / `move x y` / `click x y` / `key <VK>` / `type <text>` / `activate <hwnd>` / `fg` / `sleep ms` / `exit`。
- 坐标按 2560×1600 物理像素；脚本已 `SetProcessDPIAware`。
- **关闭**：`Stop-Process -Id (Get-Content state\helper.pid)`。

## 5. 每次执行前的三行自检

```powershell
node ..\game-daily\scripts\probe.mjs --game sr          # 环境
node ..\game-daily\scripts\coords.mjs check --game sr    # 坐标是否齐全/是否校准
# 截图 → 认屏，确认 expect 对得上
```

## 6. 降级路径（按顺序尝试）

1. 原生工具 → 直接干。
2. 没有原生工具但有 DSH → 装插件（§3）→ `wincu`。
3. 插件装不上 / 用户不想装 → `ps-helper`（§4，一次 UAC）。
4. 连 UAC 都拿不到 → **停手**，把"要点哪里"写成清单交用户点（`safety.md` §4）。
