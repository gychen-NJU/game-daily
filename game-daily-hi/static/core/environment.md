# 崩坏3 的环境自检（与 sr 同构，差异写在下面）

通用的「三条路（native / wincu / ps-helper）+ 安装与降级决策树」在
`../../game-daily/engine/adapters.md`，这里只写崩坏3 特有的部分。

## 1. 一条命令看现状

```powershell
node ..\game-daily\scripts\probe.mjs --game hi --pretty
```

关注：`screens[0].w/h`（应为 2560×1600）、`processes.game.running`（BH3）、
`processes.launcher.running`（HYP）、`helper.alive`、`adapterHints`。

## 2. 崩坏3 的进程与窗口

| 项 | 值 |
| --- | --- |
| 启动器 | `E:\miHoYo Launcher\launcher.exe`（进程名 HYP，**管理员权限**） |
| 游戏本体 | `E:\Honkai Impact 3\Games\BH3.exe`（进程名 BH3） |
| 窗口标题 | 崩坏3（全屏 2560×1600） |
| 启动耗时 | 资源检查 20–40 s，进入世界再 10–20 s |

## 3. 两条必须知道的边界

1. **UIPI**：如果游戏以管理员权限运行，普通权限进程 / 插件发的合成输入会被系统丢弃
   （表现为点击没反应、`Windows rejected cursor positioning`）→ 改用提权助手（ps-helper）。
   判断方法：`probe.mjs` 的 `processes.game.elevated`。
2. **键盘**：崩坏3 的键盘注入**尚未实测**。`hi-daily.json` 里全程只用鼠标点击 +
   左上「返回」/「主菜单」导航，不依赖 F 键或 ESC；需要打字的地方一律走点击。

## 4. 前台争夺

DSH 会不断把头抢回前台，导致点击落到 DSH 上。稳定做法（已实测）：

```powershell
# 1) 把 DSH 最小化（先征得用户同意）
(New-Object -ComObject WScript.Shell).AppActivate(...)   # 或直接用 win32 ShowWindow(SW_MINIMIZE)
# 2) 再激活游戏并立刻点击，两步必须在同一个脚本/批次里完成
```

细节：`../game-daily/engine/adapters.md` 的「前台」一节。

## 5. 截图核验

```powershell
powershell -NoProfile -File ..\game-daily\scripts\shot.ps1 -Out state\shots\check.png -RedactUid
```

打开看：**主角/按钮文字是否清楚**。崩坏3 的 UID 在右下角，交付前必须遮掉。
