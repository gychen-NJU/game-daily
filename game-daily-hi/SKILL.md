---
name: game-daily-hi
description: >-
  崩坏3「每日日常」的电脑操作执行器（game-daily 家族成员）。按固定 14 步在真实游戏界面里点完每日：
  作战任务一键领取 → 金币采集 → 家园远征（完成一条 + 一键远征）→ 打工（先领奖励再一键打工）→
  舰团委托 8 次回收 + 舰团奖池 → 材料活动一键减负 → 回任务页一键领取 → 领每日历练值 600 活跃奖励。
  当用户说"帮我清崩三日常 / 崩坏3 每日 / 崩三日常 / 做一下崩坏3 的每日任务 / 远征 / 打工 / 舰团委托 /
  一键减负 / 每日历练值"等，或要求"按文档帮我操作一遍"时使用。
  自动识别当前环境有没有电脑操作能力：DSH 需要 dsh-computer-use-win 插件，Claude Code /
  Codex 等自带 computer-use 则免装；都没有时用 PowerShell 提权助手兜底。坐标只作参考，
  首次在本机运行会先校准并记录。
---

# 崩坏3 · 每日日常

固定 14 步，跑完约 10–12 分钟。**每一步都要截图核对再动手**，这不是一键脚本。

## 0. 先做三件事（顺序别换）

1. **自检环境**
   ```powershell
   node ..\game-daily\scripts\probe.mjs --game hi --pretty
   ```
   看四样：屏幕物理尺寸（应 2560×1600）、BH3/HYP 进程、提权助手是否在跑、`adapterHints`。
2. **定适配器**：有原生 computer-use → **native**；DSH 且能看到 `mcp__wincu__windows_computer_use_*` → **wincu**；
   都没有 → **ps-helper**（PowerShell 提权助手，弹一次 UAC）。细节：`static/core/environment.md`。
3. **第一次在本机跑 → 先校准坐标**
   ```powershell
   node ..\game-daily\scripts\coords.mjs calibrate --game hi
   node ..\game-daily\scripts\coords.mjs set tasks.open 148 307 --game hi --note "主界面左上任务"
   ```

## 0.5 不在游戏里？先跑启动链（preflight）

`hi-daily.json` 的 `preflight`：起启动器 → **按图标找到崩坏3 图标**（白色/银色角色 + 左上「10 周年」角标，
对照 `references/screens/launcher-hi-icon.png`，悬停 tooltip 显示「崩坏3」）→ 开始游戏 → 等资源检查 →
「点击任意处进入游戏」→ 领每日签到。

> ⚠️ 图标**位置不固定**（本机在第 3 位；装了几个米哈游游戏就会挪）。别按序号，按图标找。

## 1. 执行循环

```powershell
node ..\game-daily\scripts\run-step.mjs --game hi --step 2        # 打印计划（不动鼠标）
node ..\game-daily\scripts\run-step.mjs --game hi --all           # 14 步全计划
```
- 计划里每个动作都带解析后的绝对坐标与来源（local / relative）。
- 用你的适配器执行；每步执行完**再截一张图**，按 `verify` 判定成功。
- 机械动作可交给脚本（仅 ps-helper 路径）：`--ps`。
- 记账：`--ps` 自动写 `state/runs/`；回看 `node ..\game-daily\scripts\peek.mjs --game hi`。

五拍：**截图 → 认屏 → 解析坐标 → 执行 → 复检**。任何一拍不对就停（见 §4）。

## 2. 14 步一览

| # | 步骤 | 关键动作 | 关键坐标 id |
|---|---|---|---|
| 1 | 主界面 → 任务 | 左上红点图标 | `tasks.open` |
| 2 | 作战任务·一键领取 | 领取登录+体力 | `tasks.onekey_claim`、`dialog.ok` |
| 3 | 金币采集（可选） | 「前往」；**通常已由步骤 2 完成** | `tasks.coin_go` |
| 4 | 家园 → 远征 | 底部「远征」 | `nav.expedition` |
| 5 | 完成一条远征 → 一键远征 | 完成远征 → 确认 → 派遣 | `exp.claim_one`、`exp.onekey`、`exp.dispatch` |
| 6 | 打工（步骤 5.5） | **先「领取奖励」**→「一键打工」→确认→**返回 ×2** | `nav.work`、`work.claim_rewards`、`work.onekey`、`work.confirm`、`nav.back` |
| 7 | 主菜单 → 任务 → 舰团委托前往 | — | `nav.main_menu`、`tasks.open`、`tasks.clan_go`（未实测） |
| 8 | 申请新委托 → 一键申请 | 1/10 → 10/10 | `comm.new`、`comm.onekey_apply` |
| 9 | 提交 → 提交委托 → 放入舰团奖励池（×8） | 剩余次数打到 0/8 | `comm.submit`、`comm.submit_confirm`、`comm.put_pool` |
| 10 | 舰团奖池领取 | 右侧第二个页签 | `side.pool_tab`、`pool.claim` |
| 11 | 主菜单 → 任务 → 材料活动前往 | — | `tasks.material_go` |
| 12 | 一键减负 → 减负 → 确定 | 吃 67 体力 | `material.onekey_reduce`、`material.reduce_confirm` |
| 13 | 主菜单 → 任务 → 一键领取 | 历练值 250→800 | `tasks.onekey_claim` |
| 14 | 每日历练值 600 | 进度条最右端图标 | `tasks.daily600` |

机器可读定义：`references/hi-daily.json`；坐标表：`references/hi-coords.json`；
认屏：`references/hi-screens.md`；参考图：`references/screens/`。

## 3. 崩坏3 特有的坑（都实跑踩过）

1. **金币采集不是家园那个管**：金币采集由「作战任务 1/1 → 一键领取」完成；家园里「金币标志对应的管」
   点下去弹的是「体力补充 / 取出体力 ×144」。
2. **打工顺序**：先「领取奖励」（亮着才点）→ 再「一键打工」。灰着 = 还没到 14 小时。
3. **打工地图没有「主菜单」**：必须连点两次左上「返回」，才能回到有底部导航的页面。
4. **「金币采集·前往」可能进「回收委托」**：BH3 的命名与预期不一致，按页面标题确认，别按按钮文案推断。
5. **弹窗两种高度**：`dialog.ok`(1280,1165) 与 `popup.ok2`(1280,1142) 别混用。
6. **付费礼包**：奖励页常有「解锁…礼包」类按钮，**绝不点**。
7. **键盘未验证**：本模块全流程只用鼠标；不要依赖 F 键 / ESC。

## 4. 什么时候必须停手

- 截图与 `expect` 对不上（版本更新 / 弹窗挡路 / 界面被改）
- 同一坐标连点两次画面没变化
- 出现 UAC、权限不足、`Windows rejected cursor positioning`
- 出现付费/删除/重置按钮，或需要判断"体力/饭团够不够、要不要继续花"
- 用户说停

停手时输出：**卡在第几步 / 现在屏幕什么样（截图路径）/ 建议用户怎么做**。

## 5. 安全与隐私（来自 `../game-daily/engine/safety.md`）

- UAC 一次只弹一个，先讲清为什么；被拒就改给手动清单。
- 只对游戏窗口发输入，执行前校验前台标题。
- 截图/日志只写本地 `state/`；对外交付前遮右下 UID 与非目标窗口。
- 委托/远征次数按 `hi-daily.json` 写的上限，不自作主张多花资源。

## 6. 文件在哪

```
..\game-daily\            家族公共层（引擎文档 + 脚本）
static\core\              本模块的环境自检与跑法
references\               流程/坐标/认屏/参考图
state\                    本机运行态：coords.local.json、runs\、shots\、helper.pid
```
`state/` 不要复制给别人，也不要把校准值写回 `references/`。
