---
name: game-daily-sr
description: >-
  崩坏：星穹铁道「每日日常」的电脑操作执行器（game-daily 家族成员）。按固定 14 步流程
  在真实游戏界面里点完每日：列车补给 → F4 指南领登录/委托/派遣/消耗 120 开拓力 →
  刷副本 → 领活跃度与 500 礼盒 → F2 无名勋礼任务与奖励一键领取。
  当用户说"帮我清星铁日常 / 星穹铁道每日 / 星铁日常 / 做一下每日任务 / 清体力 / 打本 /
  领活跃度 / 无名勋礼 / 每日实训 / 崩坏星穹铁道日常"等，或要求"按文档帮我操作一遍"时使用。
  自动识别当前环境有没有电脑操作能力：DSH 需要 dsh-computer-use-win 插件，Claude Code /
  Codex 等自带 computer-use 则免装；都没有时用 PowerShell 提权助手兜底。
  点击位置一律来自视觉定位（模板 score ≥ 0.72）；**本模块目前没有模板资产**（references/templates/
  未提供）→ 缺模板必须停手或改用 computer-use 手推；坐标表只作搜索先验，禁止直接按坐标点击。
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
3. **准备搜索先验 + 确认有没有模板**（不是"校准坐标"）
   ```powershell
   node ..\game-daily\scripts\coords.mjs calibrate --game sr        # 给先验打分辨率标签（R5）
   node ..\game-daily\scripts\coords.mjs resolve <id> --game sr --screen <客户区WxH> --json
   ```
   - 先验只用来给 `locate --region` 限定搜索窗，**不是点击坐标**（R4，规则见 `../game-daily/SKILL.md` §2.2）。
   - ⚠️ **本模块还没有模板资产**：`references/templates/` 不存在 → 现在**不能**用脚本自动点。
     日常只能按 `../game-daily/SKILL.md` §2.4 用 computer-use 一格一屏手推；要自动化得先逐 id 补模板。
   - 跑之前把客户区 / DPI / 游戏内 UI 缩放记进 `state\env-<date>.json`（见 `../game-daily/SKILL.md` §2.1）。

## 0.5 不在游戏里？先跑启动链（preflight）

`sr-daily.json` 的 `preflight` 段就是这条链：起启动器 → **按图标找到星铁图标**切页 → 开始游戏 → 等标题界面 → 点击进入（遇 `1001_1` 确认后重试一次）。

> ⚠️ 启动器左侧的星铁图标**位置不固定**（取决于本机装了几个米哈游游戏，别人是第 2 个不代表你也是）。按图标认：粉发角色 wink 笑 + 异色瞳 + 圆角方形 + 底部 `muHoYo`（对照 `references/screens/launcher-sr-icon.png`）。确认靠悬停 tooltip「崩坏：星穹铁道」。找不准就截图问用户，别挨个乱点。

## 1. 执行循环

```powershell
node ..\game-daily\scripts\run-step.mjs --game sr --step 3        # 打印计划（不动鼠标）
node ..\game-daily\scripts\run-step.mjs --game sr --all           # 14 步全计划
```
- **计划是给你看的**：每个动作带**目标 id** + 先验坐标（`local` / `relative`）。先验只能当 `--region` 的候选中心，
  **不能据此点击**（R4）；真正的点击坐标来自 `locate`。
- 用你的适配器执行；每步执行完**再截一张图**，按步骤的 `verify` 判定成功。
- `--ps` 会先 `key 18 → activate <hwnd>` 再**按先验坐标直接点**——违反 R4，只作演练/探查，日常流程不用它发点击。
- 记账：把 `locate` 的 `score / scale / cx / cy` 与 before/after 图记进 `state/runs/`；
  回看：`node ..\game-daily\scripts\peek.mjs --game sr`。

五拍：**截图 → 认屏 → 定位（模板 / 锚点+偏移）→ 点击 → 复检**。任何一拍不对就停（见 §4）。

## 2. 14 步一览

| # | 步骤 | 关键动作 | 目标 id（点击需模板） |
|---|---|---|---|
| 1 | 列车补给（可选） | 有弹窗才领 | `trainsupply.claim`（未校准） |
| 2 | F4 打开指南 | `key 115` | — |
| 3 | 领「登录游戏」+100 | 点卡下「领取」 | `guide.task_claim` |
| 4 | 委托页领奖励 | 「领取奖励」→ 关弹窗 | `dispatch.claim_reward` |
| 5 | 领委托 +100 | 回指南再领 | `guide.task_claim` |
| 6 | 前往「消耗 120 开拓力」 | 点卡下「前往」 | `guide.task_claim_c3`（或 _c2） |
| 7 | 培养目标 → 角色培养（看该角色缺什么） | 「培养目标」→「角色培养」的「前往」→ 记状态 → ESC | `index.cultivate_target`、`index.cultivate_role_enter` |
| 8 | 进入推荐副本 → 次数拉满 → 挑战 | 已培养完 → 隧洞遗器第一行「进入」；未完成 → 拟造花萼（赤）第一行 | `index.first_material_enter` / `index.calyx_red_first_enter`、`calyx.plus`、`calyx.challenge` |
| 9 | 开始挑战 → 等结算 | 「开始挑战」+ 等 3 分钟 | `team.start_challenge` |
| 10 | 退出关卡 | 「退出关卡」 | `result.exit_level` |
| 11 | 领「消耗 120 开拓力」+200 | ESC → F4 → 领取 | `guide.task_claim` |
| 12 | 点 500 礼盒 | 进度条最右礼盒 | `guide.gift500` |
| 13 | 无名勋礼·任务一键领取 | F2 → 第 2 个图标 → 一键领取 | `honor.tab_mission`、`honor.onekey_mission` |
| 14 | 无名勋礼·奖励一键领取 | 第 1 个图标 → 一键领取 | `honor.tab_reward`、`honor.onekey_reward` |

完整机器可读定义：`references/sr-daily.json`；坐标表（**只作搜索先验**）：`references/sr-coords.json`；
认屏特征：`references/sr-screens.md`；参考图：`references/screens/`。

> ⚠️ **本模块尚无 `references/templates/`**：上表 id 目前只表示"目标是谁"，没有模板就不能用 `locate` 自动点。
> 现状：日常只能 computer-use 手推（`../game-daily/SKILL.md` §2.4）；要恢复脚本化，先逐 id 补模板
> （同形按钮如 `guide.task_claim`、`calyx.plus` 还需 `<id>.anchor.png` + 1080p offset，见 R9）。

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
   **2026-10-28 更正**：helper 只要是**管理员权限**（`Start-Process -Verb RunAs`）且先 `activate <hwnd>`，
   它的合成鼠标在星铁里能点动（标题页「点击进入」、生存索引里的「前往/进入」实测通过）；
   非提权的 wincu `click` 才会报 `Windows rejected cursor positioning`。
9. **管理员权限**：`StarRail.exe` 是 `requireAdministrator`，普通权限的点击会被 UIPI 挡（报
   `Windows rejected cursor positioning`）→ 用 `ps-helper`，或 `keypress` 走键盘路径。
10. **刷什么由「角色培养」状态决定（2026-10-28 用户纠正）**：生存索引右上的「角色培养」行带「前往」，
    点它是进**角色详情**（看该角色命途与还缺什么），不是材料列表。分叉规则：
    - 该行显示 ✅「已完成等级、行迹的提升」→ 打**推荐的遗器**：点「隧洞遗器推荐」第一行「进入」
      （`index.first_material_enter`，40 开拓力/把）。本机真珠（欢愉、80/80、行迹满）就是这种。
    - 未完成 → 才打**角色材料**：左侧「拟造花萼（赤）」（行迹材料，按命途分组：欢愉→欢愉之蕾、
      毁灭→毁灭之蕾…10 开拓力/把，`index.calyx_red` → `index.calyx_red_first_enter`）或
      「凝滞虚影」（晋阶材料）。
    - 别把「培养角色」当成材料列表，也别固定只刷其中一种；副本页右下「快速刷取」不要点。

## 4. 什么时候必须停手

- 截图与 `expect` 对不上（版本更新 / 弹窗挡路 / 界面被改）
- `locate` 找不到目标（`found=false` 或 `score < 0.72`）且重试一次仍失败，或该步**模板缺失**（R3 / R7）
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
