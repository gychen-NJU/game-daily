# game-daily

> 米哈游系游戏「每日日常」的 **agent skill 家族**：把固定的每日流程写成可执行的步骤表 + 坐标表 + 认屏规则，
> 让 AI agent 能在真实游戏界面里一步步点完，**每一步都有截图核验，能停、能校准、能换环境**。

目前包含两个可执行模块：

| 模块 | 游戏 | 状态 |
| --- | --- | --- |
| `game-daily-hi` | 崩坏3 | ✅ 14 步已实跑（含打工 5.5 子步） |
| `game-daily-sr` | 崩坏：星穹铁道 | ✅ 14 步已实跑 |
| `game-daily-zzz` | 绝区零 | ⏸ 暂停：键鼠注入被 ACE 拦截，只维护文档 |

---

## 它解决什么问题

游戏日常是「固定几十次点击 + 若干判断」的重复劳动。直接让模型"看截图随便点"有三个硬伤：

1. **坐标到处漂**：换分辨率、换窗口模式、换 DPI 全废；
2. **认错界面**：弹窗挡路、活动横幅、按钮文案与实际跳转不一致；
3. **环境不确定**：有的宿主自带 computer-use，有的要装插件，有的只能靠 PowerShell 兜底。

本项目的三个设计就是冲这三点：

- **相对坐标 + 本机校准**：参考值以 2560×1600 为基准存相对值；本机实际值写 `state/coords.local.json`，不进版本库。
- **认屏优先**：每一步先声明"必须看到什么文案"，对不上就停，绝不硬点。
- **适配器三选一**：`native`（宿主自带）/ `wincu`（DSH + 插件）/ `ps-helper`（PowerShell 提权助手），由 `probe.mjs` 自动判定。

---

## 安装

这个仓库同时是 skill 目录布局，直接把三个目录复制到技能根目录即可：

```powershell
# Windows
git clone https://github.com/<you>/game-daily.git
Copy-Item game-daily\game-daily      "$HOME\.agents\skills\" -Recurse
Copy-Item game-daily\game-daily-hi   "$HOME\.agents\skills\" -Recurse
Copy-Item game-daily\game-daily-sr   "$HOME\.agents\skills\" -Recurse
```

```bash
# macOS / Linux
git clone https://github.com/<you>/game-daily.git
cp -r game-daily/game-daily* ~/.agents/skills/
```

Claude Code / Codex 等把技能放 `~/.claude/skills`、`~/.codex/skills` 的，复制到对应目录即可。

> 三个目录要放在**同级**：`game-daily/` 是家族入口，两个模块通过相对路径 `../game-daily/...`
> 引用引擎文档与脚本。

依赖：**Node ≥ 18**（脚本零依赖）；`ps-helper` 路径需要 Windows PowerShell 5.1。

---

## 快速开始

```powershell
cd "$HOME\.agents\skills\game-daily"

# 1) 环境自检：进程 / 屏幕 / 提权助手 / 适配器建议
node scripts/probe.mjs --game hi --pretty

# 2) 坐标体检：步骤引用的坐标是否都存在
node scripts/coords.mjs check --game hi
#   game=hi steps=14 referenced=26 missing=0 uncalibrated=26
#   screen=2560x1600 base=2560x1600 matches=true

# 3) 打印全流程计划（只看，不动鼠标）
node scripts/run-step.mjs --game hi --all

# 4) 第一次在本机跑：先校准
node scripts/coords.mjs calibrate --game hi
node scripts/coords.mjs set tasks.open 148 307 --game hi --note "主界面左上任务"

# 5) 回看历史
node scripts/peek.mjs --game hi
```

然后在 agent 里说一句「**帮我清崩三日常**」或「**按文档帮我操作一遍星铁每日**」，家族入口会按关键词路由到对应模块。

---

## 架构

```
game-daily/                 家族入口（SKILL.md 路由 + engine/ + scripts/）
├── engine/                 公共文档
│   ├── adapters.md         三条执行路径与降级决策树
│   ├── calibration.md      坐标校准协议
│   ├── runbook.md          五拍执行循环
│   ├── safety.md           安全与隐私红线
│   └── *.schema.json       coords / daily 两个 JSON 的 schema
└── scripts/                零依赖 Node 脚本
    ├── probe.mjs           环境自检
    ├── coords.mjs          check / calibrate / set / resolve
    ├── run-step.mjs        打印计划；--ps 时真正发输入
    ├── peek.mjs            历史与状态
    ├── shot.ps1            截图（可遮 UID）
    └── helper.ps1          PowerShell 提权输入助手

game-daily-hi/              崩坏3 模块
game-daily-sr/              星穹铁道模块
├── SKILL.md                模块说明（触发词、步骤表、坑、停手条件）
├── manifest.yaml           声明 always_load 的文档与脚本
├── references/
│   ├── <m>-daily.json      步骤定义（动作 + expect + verify + onMismatch）
│   ├── <m>-coords.json     坐标表（id → 相对坐标 + 说明 + 易错点）
│   ├── <m>-screens.md      认屏速查
│   └── screens/            参考截图
├── static/core/            环境自检与跑法细节
└── state/                  本机运行态（git 忽略）
```

**执行五拍**：`截图 → 认屏 → 解析坐标 → 执行 → 复检`。任何一拍对不上就停手，
输出「卡在第几步 / 现在屏幕什么样 / 建议怎么处理」。

---

## 适配器

| 适配器 | 适用 | 输入方式 |
| --- | --- | --- |
| `native` | Claude Code / Codex / 其他自带 computer-use 的宿主 | 宿主工具直接截图 + 点击 |
| `wincu` | DSH + `dsh-computer-use-win` 插件 | `mcp__wincu__windows_computer_use_*` |
| `ps-helper` | 任何 Windows 宿主（兜底） | 提权 PowerShell 轮询 `state/cmd.txt` |

`ps-helper` 存在的原因：很多游戏以**管理员权限**运行，普通进程发出的合成输入会被 UIPI 丢弃
（表现为点击没反应 / `Windows rejected cursor positioning`）。提权助手弹一次 UAC 后常驻，
由它发 `mouse_event` / `keybd_event` 才有效。

---

## 已知边界

- **坐标是参考值**：换分辨率 / 全屏↔窗口 / 改 DPI 都要重新校准，别直接套。
- **UI 会随版本变**：认屏对不上就停手改步骤，不要硬点；`run-step` 的 `onMismatch` 就是为此设计。
- **键盘注入**：星铁已验证可用；崩坏3 未验证，模块内全程只用鼠标。
- **绝区零**：ACE 会丢弃注入的键鼠事件（`SendInput` 返回 0、低层钩子看到 `LLKHF_INJECTED`），
  目前只保留文档，不做自动化。
- **前台争夺**：DSH 会不断抢回前台，导致点击落错窗口。已知做法是先把 DSH 最小化再操作。

---

## 扩展一个新模块

1. 复制 `game-daily-hi/` → `game-daily-<new>/`；
2. 写 `references/<new>-daily.json` 与 `<new>-coords.json`（照抄 schema）；
3. 在 `scripts/probe.mjs` 的 `GAMES` 表加一行（启动器 / 游戏进程名）；
4. 验收：`coords.mjs check --game <new>` 必须 `missing=0`，`run-step.mjs --all` 能出全部步骤；
5. 在 `game-daily/SKILL.md` 的路由表里加一行触发词。

---

## 隐私与安全

- 截图与运行日志只写本地 `state/`（已 git 忽略）；对外分享前请遮掉角色 UID 与无关窗口。
- 绝不自动点击付费礼包（"解锁…礼包"）、删除、重置类按钮。
- UAC 一次只弹一个，并先向用户说明原因；被拒就改交手动清单。
- 本项目**不含**任何游戏资源、账号信息或破解内容，只记录 UI 坐标与操作顺序。

## License

[MIT](LICENSE) © 2026 gychen-NJU
