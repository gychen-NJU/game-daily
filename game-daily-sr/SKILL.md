---
name: game-daily-sr
description: >-
  崩坏：星穹铁道「每日日常」的电脑操作执行器（game-daily 家族成员）。按固定 14 步流程
  在真实游戏界面里点完每日：列车补给 → F4 指南领登录/委托/派遣/消耗 120 开拓力 →
  刷副本 → 领活跃度与 500 礼盒 → F2 无名勋礼任务与奖励一键领取。
  当用户说"帮我清星铁日常 / 星穹铁道每日 / 星铁日常 / 做一下每日任务 / 清体力 / 打本 /
  领活跃度 / 无名勋礼 / 每日实训 / 崩坏星穹铁道日常"等，或要求"按文档帮我操作一遍"时使用。
  自动识别当前环境有没有电脑操作能力：DSH 需要 dsh-computer-use-win 插件，Claude Code /
  Codex 等自带 computer-use 则免装；都没有时用 PowerShell 提权助手兜底。坐标只作参考，
  首次在本机运行会先校准并记录。
---

# 星穹铁道 · 每日日常

固定 14 步，跑完约 8–12 分钟（其中自动战斗 3 分钟）。**每一步都要截图核对再动手**，这不是一键脚本。

## 0. 先做三件事（顺序别换）

1. **自检环境**
   ```powershell
   node ..\game-daily\scripts\probe.mjs --game sr --pretty
   ```
   看四样：屏幕物理尺寸、游戏/启动器进程、提权助手是否在跑、`adapterHints`。
2. **定适配器**（谁提供截图/点击/按键）
   - 你的工具里有原生 computer-use → 用 **native**
   - DSH 且能看到 `mcp__wincu__windows_computer_use_*` → 用 **wincu**
   - 都没有 → 用 **ps-helper**（PowerShell 提权助手，弹一次 UAC）
   细节与安装/降级决策树：`static/core/environment.md`；协议细节：`../game-daily/engine/adapters.md`。
3. **第一次在本机跑 → 先校准坐标**
   ```powershell
   node ..\game-daily\scripts\coords.mjs calibrate --game sr
   node ..\game-daily\scripts\coords.mjs set <id> <x> <y> --game sr --note "什么界面下量的"
   ```
   规则见 `../game-daily/engine/calibration.md`。**没校准就用默认相对坐标，点不中很正常，不要连点。**

## 0.5 不在游戏里？先跑启动链（preflight）

`sr-daily.json` 的 `preflight` 段就是这条链：起启动器 → **按图标找到星铁图标**切页 → 开始游戏 → 等标题界面 → 点击进入（遇 `1001_1` 确认后重试一次）。

> ⚠️ 启动器左侧的星铁图标**位置不固定**（取决于本机装了几个米哈游游戏，别人是第 2 个不代表你也是）。按图标认：粉发角色 wink 笑 + 异色瞳 + 圆角方形 + 底部 `muHoYo`（对照 `references/screens/launcher-sr-icon.png`）。确认靠悬停 tooltip「崩坏：星穹铁道」。找不准就截图问用户，别挨个乱点。

## 1. 执行循环

```powershell
node ..\game-daily\scripts\run-step.mjs --game sr --step 3        # 打印计划（不动鼠标）
node ..\game-daily\scripts\run-step.mjs --game sr --all           # 14 步全计划
```
- **计划是给你看的**：里面每个动作都带解析后的绝对坐标和来源（local / relative）。
- 用你的适配器执行；每步执行完**再截一张图**，按步骤的 `verify` 判定成功。
- 机械动作也可以交给脚本（仅 ps-helper 路径）：`--ps`；它会先 `key 18 → activate <hwnd>` 再点，避免前台被抢。
- 记账：`--ps` 会自动写 `state/runs/`；手工执行时自己补一条也行。回看：`node ..\game-daily\scripts\peek.mjs --game sr`。

五拍：**截图 → 认屏 → 解析坐标 → 执行 → 复检**。任何一拍不对就停（见 §4）。

## 2. 14 步一览

| # | 步骤 | 关键动作 | 关键坐标 id |
|---|---|---|---|
| 1 | 列车补给（可选） | 有弹窗才领 | `trainsupply.claim`（未校准） |
| 2 | F4 打开指南 | `key 115` | — |
| 3 | 领「登录游戏」+100 | 点卡下「领取」 | `guide.task_claim` |
| 4 | 委托页领奖励 | 「领取奖励」→ 关弹窗 | `dispatch.claim_reward` |
| 5 | 领委托 +100 | 回指南再领 | `guide.task_claim` |
| 6 | 前往「消耗 120 开拓力」 | 点卡下「前往」 | `guide.task_claim_c3`（或 _c2） |
| 7 | 培养目标 → 第一个材料 → 进入 | 导航 + 「进入」 | `index.cultivate_target`、`index.first_material_enter` |
| 8 | 次数加到最大 → 挑战 | 「+」×N →「挑战」 | `calyx.plus`、`calyx.challenge` |
| 9 | 开始挑战 → 等结算 | 「开始挑战」+ 等 3 分钟 | `team.start_challenge` |
| 10 | 退出关卡 | 「退出关卡」 | `result.exit_level` |
| 11 | 领「消耗 120 开拓力」+200 | ESC → F4 → 领取 | `guide.task_claim` |
| 12 | 点 500 礼盒 | 进度条最右礼盒 | `guide.gift500` |
| 13 | 无名勋礼·任务一键领取 | F2 → 第 2 个图标 → 一键领取 | `honor.tab_mission`、`honor.onekey_mission` |
| 14 | 无名勋礼·奖励一键领取 | 第 1 个图标 → 一键领取 | `honor.tab_reward`、`honor.onekey_reward` |

完整机器可读定义：`references/sr-daily.json`；坐标表：`references/sr-coords.json`；
认屏特征：`references/sr-screens.md`；参考图：`references/screens/`。

## 3. 星铁特有的坑（每一条都实跑踩过）

1. **F4 只在游戏世界生效**：开着面板（生存索引/委托/背包）时 F4 无效 → 先 `key 27`（ESC）关面板。
2. **指南任务卡是横向滚动的**：按钮 x 随卡片位置变化，同一个坐标可能点到"别的卡"。以当前截图为准，必要时用 `_c2` / `_c3` 或重新校准。
3. **「一键领取」的 y 比看起来高**：任务页实际 ≈1300（相对 0.8125），按视觉中心 0.86 点会落空。
4. **委托领取后常常自动续派**（4/4，0/30 小时），没有「一键派遣」就跳过，不要硬找。
5. **「获得物品」弹窗会吃掉点击**：先点空白 `popup.close_blank` 再继续。
6. **付费按钮**：`解锁无名客的勋礼`（¥680）就在奖励页「一键领取」旁边，**绝不点**。
7. **进游戏时的「登录异常 1001_1」**：本机无代理也会偶发，点「确认」重试一次即可（属前置步骤，日常里通常遇不到）。
8. **输入通道实测（2026-10-23，已确认）**：`StarRail.exe` 会过滤 `ps-helper` 的合成鼠标
   （`SetCursorPos` + `mouse_event`：标题页「点击进入」能点、`key 115`(F4)/`key 27`(ESC) 有效，但面板里的
   页签与「前往/进入」按钮毫无反应）；而 **harness 的电脑控制 `mcp__wincu__windows_computer_use_*`
   可以正常接管**（用户确认"之前测过、已经跑通过"）。
   ⇒ **星铁一律 computer-use 优先**：`screenshot(windowTitle="星穹铁道")` → `read_image` 判读 →
   `click` / `keypress` → 再截图复检；`ps-helper` 只用来 `start`/`kill` 进程、发键盘。
   **别因为"ps-helper 点不动"就判定星铁不能自动化**（10-23 我犯过这个错）。
9. **管理员权限**：`StarRail.exe` 是 `requireAdministrator`，普通权限的点击会被 UIPI 挡（报
   `Windows rejected cursor positioning`）→ 用 `ps-helper`，或 `keypress` 走键盘路径。

## 4. 什么时候必须停手

- 截图与 `expect` 对不上（版本更新 / 弹窗挡路 / 界面被改）
- 同一坐标连点两次画面没变化
- 出现 UAC、权限不足、`Windows rejected cursor positioning`
- 出现付费/删除/重置按钮，或需要判断"体力够不够、要不要继续花"
- 用户说停

> ⚠️ **「点击无反应」不等于今天放弃**：按 `../game-daily/engine/adapters.md` §8，改用 harness 的
> computer-use（`mcp__wincu__windows_computer_use_*`）一步一屏手推完剩下的步骤，并在报告里注明哪几步是手推的。
> 用户 2026-10-23 明确要求：脚本走不通就用 computer-use 把日常做完。

停手时输出：**卡在第几步 / 现在屏幕什么样（截图路径）/ 建议用户怎么做**。

## 5. 安全与隐私（从 `../game-daily/engine/safety.md` 来，必须遵守）

- UAC 一次只弹一个，先讲清为什么；被拒就改给手动清单。
- 只对游戏窗口发输入，执行前校验前台标题。
- 截图/日志只写本地 `state/`；对外交付前遮 UID 和非目标窗口。
- 刷本次数按 `sr-daily.json` 写的上限，不自作主张多花体力。

## 6. 文件在哪

```
..\game-daily\            家族公共层（引擎文档 + 脚本）
static\core\              本模块的环境自检与跑法
references\               流程/坐标/认屏/参考图
state\                    本机运行态：coords.local.json、runs\、shots\、helper.pid
```
`state/` 不要复制给别人，也不要把校准值写回 `references/`。
