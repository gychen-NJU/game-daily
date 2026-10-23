---
name: game-daily
description: >-
  米哈游系游戏「每日日常」的统一入口（family hub）。用户说"帮我清日常 / 做一下每日 / 每日任务 /
  按文档帮我操作一遍"并提到具体游戏时，先按关键词路由到对应子模块：
  崩坏3 / 崩三 / 崩坏 3 → game-daily-hi；星穹铁道 / 星铁 / 崩铁 / 铁道 / 崩坏星穹铁道 → game-daily-sr；
  绝区零 / ZZZ → game-daily-zzz（暂停中，只做文档不实操）。
  本 skill 不直接执行任何点击：它只负责选模块、讲清公共约定（环境自检三条路、坐标校准、
  安全红线、状态目录），然后把活交给子模块的 SKILL.md。
  脚本/坐标点击走不通时（同一坐标连点两次无反应、或鼠标被过滤但键盘有效，如星铁进游戏后的面板），
  按 §2.4 与 engine/adapters.md §8 改用 harness 的 computer-use（mcp__wincu__windows_computer_use_*）
  逐屏手推完当天日常，不放弃、也不硬刷。
---

# game-daily · 家族入口

## 1. 先路由（一句话判定）

| 用户提到的词 | 子模块 | 状态 |
| --- | --- | --- |
| 崩坏3、崩三、崩坏 3、BH3 | `game-daily-hi` | ✅ 可执行（14 步已实测） |
| 星穹铁道、星铁、崩铁、铁道 | `game-daily-sr` | ✅ 可执行（14 步已实测） |
| 绝区零、ZZZ | `game-daily-zzz` | ⏸ 暂停：键鼠注入被 ACE 拦，只维护文档 |
| 只说了"日常"、没点名游戏 | — | **问一句**："哪个游戏？" |

路由后**立刻加载对应子模块的 SKILL.md**，按它的步骤走。本文件不再重复步骤。

## 2. 三个公共约定（所有子模块共享）

### 2.1 先自检环境，再动手

```powershell
node ..\game-daily\scripts\probe.mjs --game <hi|sr|zzz> --pretty
```

- 屏幕物理尺寸（崩坏3/星铁本机 2560×1600）
- 游戏/启动器进程是否在跑、是否 elevated
- 提权助手是否在跑
- `adapterHints`：**有原生 computer-use → native／DSH 有 wincu 插件 → wincu／都没有 → ps-helper**

判定与安装细节：`engine/adapters.md`。**不要假设自己一定有电脑操作能力**：没有就先把
"装什么、怎么装、装完怎么验"讲给用户，再继续。

### 2.2 坐标只是参考，第一次必须校准

- 参考坐标是**相对坐标**（rx, ry，基准见 `engine/coords.schema.json`），本机值存
  `state/coords.local.json`（不进版本库）。
- 换分辨率 / 换窗口模式 / 改 DPI → 必须重新校准：
  ```powershell
  node ..\game-daily\scripts\coords.mjs calibrate --game <m>
  node ..\game-daily\scripts\coords.mjs set <id> <x> <y> --game <m> --note "说明"
  ```
- 校准流程见 `engine/calibration.md`。

### 2.3 安全红线（不过就停）

- UAC 一次只弹一个，先讲清为什么；被拒 → 改给手动清单，不重试。
- 只对目标游戏窗口发输入；每批点击前校验前台标题。
- **绝不点**付费礼包（"解锁…礼包"）、删除、重置这类按钮。
- 截图/日志只写本地 `state/`；对外交付遮角色 UID 与无关窗口。
- 同一坐标连点两次画面无变化 → 停手，别硬刷。

### 2.4 脚本走不通 → 换 computer-use 手动推（**用户明确要求，别硬刷**）

只要出现下面任一条，就说明"坐标点击这条路对这个游戏失效了"，**立刻停手**：

- 同一坐标连点两次、画面毫无变化（不是坐标偏，是界面不响应）；
- 鼠标点了没反应但**键盘有效**（本机星铁就是：`key 115` 能开「星际和平指南」，用 `ps-helper` 的合成点击
  点页签/「前往」全无反应——**被过滤的只是合成鼠标；harness 的 computer-use 能正常接管，已实测跑通**）；
- 脚本/探针明确报"该窗口拒绝合成输入"。

此时**不要放弃这一天的日常**，改把 harness 的 computer-use 当"手"、把步骤表当"导航"，一步一屏推完：

```
windows_computer_use_screenshot(windowTitle="星穹铁道|崩坏3")  →  read_image 判读
→  windows_computer_use_click / keypress  →  再截图复检  →  记下这一步
```

要点：① 每步都带 `windowTitle`，否则截到的是抢回前台的 DSH；② 目标窗口是管理员权限时
`click` 可能被 UIPI 拦，改走 `keypress` 或回 ps-helper；③ 常规 Windows 窗口（启动器/登录框）
用 `snapshot`+`find`+`invoke` 比点像素稳；④ 收工在报告里写清"哪几步是 computer-use 手推的"。

完整切换判据、工具映射与红线：`engine/adapters.md` §8。

## 3. 执行循环（三模块通用）

**截图 → 认屏 → 解析坐标 → 执行 → 复检**，任何一拍对不上就停。

```powershell
node ..\game-daily\scripts\run-step.mjs --game <m> --step N   # 打印计划
node ..\game-daily\scripts\run-step.mjs --game <m> --all      # 全流程计划
```

`--ps` 只用 ps-helper 时才会真正发输入；native/wincu 由 agent 自己调用对应工具。

## 4. 目录约定

```
game-daily/                  ← 本文件（入口）+ engine/ + scripts/
game-daily-hi/               ← 崩坏3 模块
game-daily-sr/               ← 星铁模块
game-daily-zzz/              ← 绝区零模块（暂停）
```

每个模块：`SKILL.md` / `manifest.yaml` / `references/<m>-daily.json` /
`references/<m>-coords.json` / `references/<m>-screens.md` / `references/screens/` / `state/`。

## 5. 加新模块（扩展点）

1. 复制 `game-daily-hi/` 为 `game-daily-<new>/`
2. 写 `references/<new>-daily.json`（步骤 + expect + verify）与 `<new>-coords.json`
3. `probe.mjs` 的 `GAMES` 表加一行（launcher / game 进程名）
4. `coords.mjs check --game <new>` 必须 `missing=0`，`run-step.mjs --all` 能出全流程
5. 在本文件的 §1 路由表加一行
