# game-daily-sr · 崩坏：星穹铁道 每日日常

`game-daily` 家族的星铁模块。**14 步全部在本机实跑过**（2026-10-23）。

## 覆盖什么

| # | 步骤 | 关键动作 |
| --- | --- | --- |
| 1 | 从启动器进入游戏 | 启动器 → 按图标找星铁 → 开始游戏 → 点击进入 |
| 2 | 列车补给（可选） | 有弹窗才领 |
| 3 | F4 打开指南 | 面板开着时 F4 无效，先 ESC |
| 4 | 领「登录游戏」+100 | — |
| 5 | 委托领奖 / 派遣 +100 | 领完自动续派，没有「一键派遣」就跳过 |
| 6 | 前往「消耗 120 开拓力」 | 生存索引 → 培养目标 |
| 7 | 进入副本 | 第一个推荐材料 → 进入 |
| 8 | 次数加满 → 挑战 | 上限 6 次（40 开拓力/把） |
| 9 | 开始挑战 | 自动战斗约 2 分 50 秒 |
| 10 | 退出关卡 | 只点「退出关卡」，别点「再来一次」 |
| 11 | 领 +200 / 消灭敌人 +100 | 活跃度到 500 |
| 12 | 点 500 礼盒 | 星琼 60 等 |
| 13 | F2 无名勋礼 → 任务 | 顶部第 2 个图标 → 一键领取（y≈1300） |
| 14 | 无名勋礼 → 奖励 | 顶部第 1 个图标 → 一键领取 |

跑完约 **8–12 分钟**。

## 目录

```
SKILL.md              触发词、14 步表、星铁专有坑、停手条件
manifest.yaml         always_load：家族引擎 4 篇 + 本模块 static 2 篇
references/
  sr-daily.json       14 步定义
  sr-coords.json      坐标表（22 项，含 guide.task_claim_c2/c3、trainsupply.claim 占位）
  sr-screens.md       认屏速查（16 个界面）
  screens/            9 张参考图（含启动器星铁图标）
static/core/
  environment.md      进程 / UIPI / 前台
  runbook-sr.md       跑法细节（键位、计时、坑）
state/                本机运行态（git 忽略）
```

## 用法

```powershell
cd "$HOME\.agents\skills\game-daily"

node scripts/probe.mjs --game sr --pretty
node scripts/coords.mjs check --game sr
node scripts/run-step.mjs --game sr --all
```

在 agent 里说「**帮我清星铁日常**」「星穹铁道每日」即可路由到本模块。

## 星铁特有的坑

1. **F4 / F2 只在游戏世界里生效**：面板开着先 `ESC`。
2. **委托领取后自动续派**（4/4、0/30 小时），没有「一键派遣」按钮是正常的。
3. **无名勋礼「一键领取」在 y≈1300**，不是视觉中心 ~1380——这是最容易点空的一处。
4. **点「点击进入」可能弹「登录异常 1001_1」**：本机无代理，属瞬态，点「确定」再点一次即可。
5. **只点「退出关卡」**：「再来一次」会再消耗体力。
6. **启动器图标不固定在第几个**：按图标（白色/粉色角色、10 周年/周年角标）+ 悬停 tooltip 确认。

## 依赖

- Node ≥ 18
- 启动器 `E:\miHoYo Launcher\launcher.exe`（HYP）
- 游戏 `E:\Star Rail\Game\StarRail.exe`（requireAdministrator，需提权助手才能注入）

## License

[MIT](../LICENSE)
