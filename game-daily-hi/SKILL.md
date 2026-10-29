---
name: game-daily-hi
description: >-
  崩坏3「每日日常」的电脑操作执行器（game-daily 家族成员）。按固定 14 步在真实游戏界面里点完每日：
  作战任务一键领取 → 金币采集 → 家园远征（完成一条 + 一键远征）→ 打工（先领奖励再一键打工）→
  舰团委托 8 次回收 + 舰团奖池 → 材料活动一键减负 → 回任务页一键领取 → 领每日历练值 600 活跃奖励。
  当用户说"帮我清崩三日常 / 崩坏3 每日 / 崩三日常 / 做一下崩坏3 的每日任务 / 远征 / 打工 / 舰团委托 /
  一键减负 / 每日历练值"等，或要求"按文档帮我操作一遍"时使用。
  自动识别当前环境有没有电脑操作能力：DSH 需要 dsh-computer-use-win 插件，Claude Code /
  Codex 等自带 computer-use 则免装；都没有时用 PowerShell 提权助手兜底。
  点击位置一律来自视觉定位（scripts/locate.mjs，模板 references/templates/<id>.png，
  默认阈值 0.72）：先认屏文案、再定位、分数不够就停手；坐标表只作搜索先验，禁止直接按坐标点击。
---

# 崩坏3 · 每日日常

固定 14 步，跑完约 10–12 分钟。**每一步都要：截图 → 认屏 → 定位 → 点击 → 复检**，这不是一键脚本，
也不是"按坐标表点一遍"。规则编号 R1–R9 见 `..\game-daily\SKILL.md` §2.2（全家族统一，本文件只落地到崩坏3）。

## 0. 先做三件事（顺序别换）

1. **自检环境**
   ```powershell
   node ..\game-daily\scripts\probe.mjs --game hi --pretty
   ```
   看四样：屏幕物理尺寸（**只作背景信息**，不是坐标系）、BH3/HYP 进程、提权助手是否在跑、`adapterHints`。
   窗口**客户区**尺寸由下一步的 `locate` 抓图给出（`capture.window` / `capture.clientOrigin`）——那才是坐标系（R8）。
   并把 **客户区尺寸 + 系统 DPI 缩放 + 游戏内有没有动过 UI 缩放** 记进 **`state\env-<date>.json`**
   （字段格式见 `..\game-daily\SKILL.md` §2.1）；客户区不是 16:9 或 DPI ≠ 100% 时，所有先验一律降级为
   "搜索窗口"，不能当点击依据。
2. **定适配器**：有原生 computer-use → **native**；DSH 且能看到 `mcp__wincu__windows_computer_use_*` → **wincu**；
   都没有 → **ps-helper**（PowerShell 提权助手，弹一次 UAC）。细节：`static/core/environment.md`。
   三种适配器的点击坐标都取自定位结果，差别只在"谁去点"（见 `..\game-daily\engine\adapters.md` §9）。
3. **准备"先验 + 模板"（不是校准点击坐标）**

   > 脚本 `locate.mjs` / `layout.mjs` / `run-step.mjs` 由 `..\game-daily\scripts\` 提供，契约见
   > `..\game-daily\engine\adapters.md` §9.7；模板资产已就位（`references\templates\`，含 `index.json`
   > 外观变体表与 `anchors.json` 锚点偏移表，2026-10-30 实跑验证）。**若某个 id 的模板 / 锚点条目缺失**：
   > 该步不做坐标兜底——按 §4 / `adapters.md` §8 改用 computer-use 逐屏手推，或先补模板再跑。

   ```powershell
   # ① 先验：布局解析，只用来给 locate 限定 --region
   node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen <客户区WxH> --all --json
   # ② 本机先验（可选，只作搜索范围线索）；每条必须带 screen，与当前客户区不符 → 不可用（R5）
   node ..\game-daily\scripts\coords.mjs resolve tasks.open --game hi --screen <客户区WxH> --json
   # ③ 模板自检：每个会点的 id 都要能用模板在本机命中
   node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" --template "references\templates\tasks.open.png" --json
   ```

   - 模板是**模块发布物**，固定在 `references\templates\<id>.png`；不要在本机私自截一张图替换它。
   - 同一 id 可有多外观变体（`templates\index.json`，如 `dialog.ok` 同时配 `dialog.ok.png` / `popup.ok2.png`），
     `locate` 逐个试、**取最高分**；新增外观只需加 png 并挂进 `index.json`。
   - 命中要求 `found=true` 且 `score ≥ 0.72`。自检不过的 id → 该步今天不可执行（停手报告），
     **不许退回坐标点击**（R3/R4）。
   - 最省事的整体自检：`run-step.mjs --game hi --probe --all`（只截图 + 定位、绝不点击）——
     全过 exit 0、任一未命中 exit 2，打印每步 `via / score / scale / client / region / shot`。

## 0.5 不在游戏里？先跑启动链（preflight）

`hi-daily.json` 的 `preflight`：起启动器 → **按图标找到崩坏3 图标**（白色/银色角色 + 左上「10 周年」角标，
对照 `references/screens/launcher-hi-icon.png`，悬停 tooltip 显示「崩坏3」）→ 开始游戏 → 等资源检查 →
「点击任意处进入游戏」→ 领每日签到。

> ⚠️ 图标**位置不固定**（本机在第 3 位；装了几个米哈游游戏就会挪）。别按序号，按图标找——
> 这本来就需要视觉，用 `locate`（模板 `launcher.hi_icon`）或直接读图确认，不猜坐标。

启动器阶段是**普通 Windows 窗口**：视觉定位照样适用，但窗口被遮挡时先置前；抓不到图 → 停手，别点。

## 1. 执行循环

```powershell
node ..\game-daily\scripts\run-step.mjs --game hi --step 2        # 打印计划（不动鼠标）
node ..\game-daily\scripts\run-step.mjs --game hi --all           # 14 步全计划
```

- 计划里每个动作带的 `(x, y)` 与 `source`（local / relative）是**先验**，只帮你理解"大概在哪"，
  **不得直接点击**（R4）。真正的点击坐标来自 `locate`。
- 单步点击的完整动作（以 wincu / native 为例）：

  ```powershell
  # ① 点击前截图（R1）；② 认屏（R2，对照 references/hi-screens.md 的 expect）
  # ③ 定位（R3）
  node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" `
       --template "references\templates\tasks.open.png" `
       --threshold 0.72 --json
  # ④ 命中后：屏幕坐标 = capture.clientOrigin + (cx, cy)，点它
  # ⑤ 点击后再截一张（R1/R6），按该步 verify 判定
  ```

  - `found=false` 或 `score < 0.72`（exit 2）→ **不点**。只允许**重试一次**：可收紧 `--region`
    （用 layout 的 `x,y` 作中心、给足余量），或确认窗口仍在前台。仍失败 → 按 `onMismatch`（**stop 优先**）。
  - 不确定搜索区域就**不带 `--region`**：全客户区搜索，慢一点但不会把目标切掉。
  - `--region` 是**消歧手段**（把搜索窗收窄、抬高 uniqueness），**不是"降级成盲点"**：窗内找不到照样 exit 2。
    同页多行同形按钮的固定用法见 `templates\regions.json`（`{"<id>":{"pad":[半宽x,半宽y]}}`，
    由 `run-step.mjs` 的 `layoutRegion()` 读取、覆盖默认 ±320；单位 = **当前客户区像素**，不乘 scale；
    缺条目/坏表 = 退回默认 ±320）。
  - `capture.clientOrigin` 是客户区左上角的屏幕坐标；`cx,cy` 相对客户区。别把两者混用（R8）。
- `--ps` 会按先验坐标直接点击，**违反 R4**：日常流程里不再用它发点击，只留作演练/探查
  （它不认屏、不定位、不验分）。ps-helper 路径的正确用法：把 `clientOrigin + cx,cy` 写进 `cmd.txt`
  的 `click`（协议见 `..\game-daily\engine\adapters.md` §4 与 §9）。
- 记账：`state/runs/<date>.json` 追加 `{step, n, id, template, found, score, scale, cx, cy, screenClick, verify}`；
  截图落 `state/shots/<date>/<step>-<n>-before.png` / `-after.png`（R6）。回看：`peek.mjs --game hi`。

- `run-step.mjs` 的定位开关（2026-10-30 新增，崩三已实测可用）：

  | 开关 | 行为 | 退出码 |
  | --- | --- | --- |
  | `--locate` | 每个 click **先实时截图 → 定位 → 过阈值才点**（`--threshold`，默认 0.72）；任一步不过即 fail-closed，不点 | `0` 全过 / `3` 有步失败（已停） |
  | `--probe` | **只截图 + 定位，绝不点击**；逐行打印 `via / score / scale / client / region / shot` | `0` 全过 / `2` 任一步未命中 |
  | `--anchor-only` | 跳过直接模板、只走 anchor+offset（排障：验证 `anchors.json` 条目是否可命中） | 同上 |

  定位优先级（`--locate` / `--probe` 共用）：① 直接模板（`index.json` 里该 id 的全部变体，先验只用来缩 `--region`；
  同形页的窗由 `templates\regions.json` 的 `pad` 收窄）→ ② 锚点模板**全屏**搜索 + `offset × scale` → ③ 都失败 → 停手（exit 3 / 2），不退回坐标。

  ```powershell
  node ..\game-daily\scripts\run-step.mjs --game hi --step 2 --probe   # 演练：只看定位结果，不点
  node ..\game-daily\scripts\run-step.mjs --game hi --step 2 --locate  # 真跑：先定位再点
  ```

#### 已经跑出来的证据（2026-10-30，1080p 实机）

1. **step2 实跑**：`tasks.onekey_claim` 命中 score **1.0** → 点击 → 弹出「领取奖励」；此时单个模板对「确定」
   只有 **0.579 < 0.72** → **fail-closed 停手（exit 3）**。把 `popup.ok2.png` 挂成 `dialog.ok` 的外观变体后，
   同一张图 **1.0** —— 这就是 `index.json` 存在的理由。证据：`state\shots\evidence\`。
2. **锚点法抗行序变化**：某天任务行序与参考图完全不同，目标先验位置偏了 **402 px**，锚点法仍命中
   `(984,381)`、score **1.0** —— 先验错 402px 也能找对，这就是 R9 的价值。
3. **灰态按钮也会匹配**：`tasks.onekey_claim` 灰态 score **0.9615**（ZNCC 对亮度线性变化不敏感）——
   但**灰 ≠ 可点**：灰态仍按复检文案/数值判断下一步，不能因为"匹配上了"再点一下。
4. **同页像素级同形 → 紧搜索窗消歧**：远征页有 4~5 个「完成远征」按钮，全屏匹配 score **1.0** 但
   `ambiguous=true`（runnerUp 0.9972、uniqueness 0.0028）→ **exit 2**；把窗收成首行
   （先验 y±70，`templates\regions.json` 的 `{"exp.claim_one":{"pad":[180,70]}}`）后 →
   score **0.9995**、uniqueness **0.6442**、`ambiguous=false` → **exit 0**。任意一行功能等价，
   所以不需要锚点定位到"具体某行"——这是 `regions.json` 与 `anchors.json` 的分工。

五拍：**截图（R1）→ 认屏（R2）→ 定位（R3）→ 点击 → 复检（R6）**。任何一拍不对就停（见 §4）。

## 2. 14 步一览

| # | 步骤 | 关键动作 | 目标 id（点击需模板） |
|---|---|---|---|
| 1 | 主界面 → 任务 | 左上红点图标 | `tasks.open` |
| 2 | 作战任务·一键领取 | 领取登录+体力 | `tasks.onekey_claim`、`dialog.ok` |
| 3 | 金币采集（可选） | 「前往」；**通常已由步骤 2 完成** | `tasks.coin_go` |
| 4 | 家园 → 远征 | 进「家园」后点**底栏**「远征」（不是主界面 dock） | `nav.expedition` |
| 5 | 完成一条远征 → 一键远征 | 完成远征 → 确认 → 派遣 | `exp.claim_one`、`exp.onekey`、`exp.dispatch` |
| 6 | 打工（步骤 5.5） | 进「家园」后点**底栏**「打工」（不是主界面 dock）；**先「领取奖励」**→「一键打工」→确认→**返回 ×2** | `nav.work`、`work.claim_rewards`、`work.onekey`、`work.confirm`、`nav.back` |
| 7 | 主菜单 → 任务 → 舰团委托前往 | — | `nav.main_menu`、`tasks.open`、`tasks.clan_go`（R9 锚点） |
| 8 | 申请新委托 → 一键申请 | 1/10 → 10/10 | `comm.new`、`comm.onekey_apply` |
| 9 | 提交 → 提交委托 → 放入舰团奖励池（×8） | 剩余次数打到 0/8 | `comm.submit`、`comm.submit_confirm`、`comm.put_pool` |
| 10 | 舰团奖池领取 | 右侧第二个页签 | `side.pool_tab`、`pool.claim` |
| 11 | 主菜单 → 任务 → 材料活动前往 | — | `tasks.material_go` |
| 12 | 一键减负 → 减负 → 确定 | 吃 67 体力 | `material.onekey_reduce`、`material.reduce_confirm` |
| 13 | 主菜单 → 任务 → 一键领取 | 历练值 250→800 | `tasks.onekey_claim` |
| 14 | 每日历练值 600 | 进度条最右端图标 | `tasks.daily600` |

"目标 id"列的每个 id 都对应一个**定位模板** `references/templates/<id>.png`；该表里的 id 就是
"要点的东西"，不是"要用的坐标"。机器可读定义：`references/hi-daily.json`；锚点先验：`references/hi-layout.json`；
认屏：`references/hi-screens.md`；参考图：`references/screens/`。

**同形按钮必须消歧（不能只点模板中心，也不能拿单模板全屏匹配）**：`tasks.coin_go`、`tasks.clan_go`、
`tasks.material_go`、`tasks.dorm_work_go`、`exp.claim_one`、`comm.submit` 属于"同一屏出现多个同形按钮"，
坐标先验只代表**某一天的某一行**，隔天任务内容/行序变化、换分辨率、列表滚动都会错位。
**三种手段按顺序选**：① 外观不同 → `index.json` 变体；② 必须点"指定那一行" → 锚点 + offset（下面 1–3 步）；
③ 同页同形、**任意一行都行**（功能等价）→ `regions.json` 紧搜索窗（`pad`，见白名单 `exp.claim_one`）。
做法（`scripts\run-step.mjs` 已内置，也可手工执行）：

1. locate **行标题锚点** `references\templates\<id>.anchor.png`（如「金币采集」这段文字）→ 得 `(cx,cy)`、`scale`；
   **锚点必须全屏搜**（锚点离目标约 402 px，套目标先验的 `--region` 会把它切掉）。
2. 点 `目标 = (cx,cy) + (dx,dy) × scale`，`(dx,dy)` 从 `references\templates\anchors.json` 读（单位 1080p 像素）。
3. `anchors.json` 缺该 id → **该步不可执行**（停手 / computer-use 手推），不许拿坐标表里的 x,y 顶替。

2026-10-30 实测：作战任务页四行「前往」偏移一致 `(+402,+98)`（如「金币采集」锚点 (582,283) → 按钮 (984,381)）。

**模板状态（2026-10-30 白名单，口径 = locate 实测）**：`nav.expedition` = 已验（score **1.0000**、center
`(1225,995)`、uniqueness 0.45）→ **可直点**；`nav.work` = 已验（score **1.0000**、center `(1470,995)`、
uniqueness 0.49）→ **可直点**；`exp.onekey` = 已验（score **1.0000**、center `(1746,998)`、uniqueness **0.4923**）
→ **可直点**；
`exp.claim_one` = **有模板，但要靠 `regions.json` 紧窗消歧才可执行**（条目已在：`pad [180,70]`；紧窗后 score
**0.9995**、uniqueness **0.6442**、`ambiguous=false` → exit 0，点首行即可——任意一行功能等价）。
**缺 `regions.json` 条目 → 退回默认 ±320 → 同形页必然 ambiguous（runnerUp 0.9972 / uniqueness 0.0028）
→ exit 2 → 不可执行**（分数高 ≠ 唯一，这不是调阈值能解决的）。
其余 id 的模板仍缺（`tasks.open`、`nav.home`、`exp.dispatch`、`work.*`、`comm.*`、`material.*`、
`tasks.daily600`、启动器几个）→ 缺一个停一步，不退回坐标。

### 2.1 每步的可判定通过条件

每个点都必须**同时**满足两组条件：R2（认屏文案对得上）+ R3（`locate` 命中且 `score ≥ 0.72`）。
逐条勾，一条打不上勾就停（R7）。

| # | 认屏必见文案（R2，进入本步前） | 点击目标 id 与门槛（R3） | 复检（R6，点完） |
|---|---|---|---|
| 1 | 左侧 任务/活动/福利/邮件/公告/商城 + 底部 舰团/家园 | `tasks.open` ≥ 0.72 | 打开「作战任务」，见「历练任务」「一键领取」 |
| 2 | 「作战任务」「历练任务」「一键领取」「每日历练值」 | `tasks.onekey_claim`；有弹窗则 `dialog.ok` | 「一键领取」灰掉，或历练值/体力数字变大 |
| 3 | 作战任务页，「金币采集」可前往 | `tasks.coin_go` | 进入目标页；**页面标题可能是回收委托**（坑 4） |
| 4 | 家园房间：家园福利/家园商店/打工/宿舍/神之键 | `nav.expedition` | 见「今日远征可用体力」「一键远征」 |
| 5 | 远征页 6 条列表 + 每条右侧「完成远征」 | `exp.claim_one`（`regions.json` 紧窗）→`exp.onekey`→`exp.dispatch` | 远征状态变已派遣；剩余次数减少 |
| 6 | 打工地图：顶部「饭团」+ 右下「一键打工」「领取奖励」 | 先 `work.claim_rewards`，再 `work.onekey`，弹窗 `work.confirm`，返回 `nav.back` ×2 | 饭团消耗、打工格亮起或奖励数字变化 |
| 7 | 主界面（底部导航在）→ 任务页 | `nav.main_menu`→`tasks.open`→`tasks.clan_go` | 进「回收委托」页（见「申请新委托」「提交」） |
| 8 | 回收委托：右下「今日剩余次数」、底部「申请新委托」 | `comm.new`→`comm.onekey_apply` | 「委托申请次数」1/10 → 10/10 |
| 9 | 委托列表 + 底部「提交」 | `comm.submit`→`comm.submit_confirm`→`comm.put_pool`（立即提交后才轮下一次） | 剩余次数 -1；循环到 0/8 即停 |
| 10 | 舰团奖池：「常规发放」「随机发放」「舰团总贡献」「领取」 | `side.pool_tab`→`pool.claim` | 水晶/贡献数字变化 |
| 11 | 主界面 → 任务页，材料活动「前往」可选 | `tasks.material_go` | 进「材料活动」页，见四张卡 |
| 12 | 材料活动：「一键减负」+ 四张卡 | `material.onekey_reduce`→确认 `material.reduce_confirm` | 提示体力消耗（本机吃 67），卡片状态更新 |
| 13 | 作战任务页 | `tasks.onekey_claim` | 历练值跨档（250→800 一类），档位图标点亮 |
| 14 | 任务页底部进度条到 600 | `tasks.daily600` | 弹出「领取奖励/获得奖励」→ 领完数字变化 |

> 第 9 步是 8 次循环（`repeat.times=8`）：第 1 次前先做第 8 步，之后"申请新委托 → 一键申请 → 提交 →
> 提交委托 → 放入舰团奖励池"；**剩余次数显示 0/8 就停**，别多点。每一轮同样要过 `locate` 门槛，
> 界面滚动/弹窗后旧模板可能失配 → 按 R3 重试一次，仍失配就停手。

## 3. 崩坏3 特有的坑（都实跑踩过）

1. **金币采集不是家园那个管**：金币采集由「作战任务 1/1 → 一键领取」完成；家园里「金币标志对应的管」
   点下去弹的是「体力补充 / 取出体力 ×144」。
2. **打工顺序**：先「领取奖励」（亮着才点）→ 再「一键打工」。灰着 = 还没到 14 小时。
3. **打工地图没有「主菜单」**：必须连点两次左上「返回」，才能回到有底部导航的页面。
4. **「金币采集·前往」可能进「回收委托」**：BH3 的命名与预期不一致，按页面标题确认，别按按钮文案推断。
5. **弹窗两种高度**：`dialog.ok` 与 `popup.ok2` 差 23 px，别混用——**这正是不能按坐标点的例子**。
   1080p 实测 `dialog.ok` = (959,797)：x 符合宽度律（1280×0.75 ≈ 960），但 y 用宽度律外推 814、
   高度律外推 786，实测 797，两边都对不上 → **弹窗只能模板定位**。
   而且同一 id 有两种外观（签到弹窗的「确定」带 ✓、领取奖励的不带），所以 `index.json` 给它挂两个变体。
6. **付费礼包**：奖励页常有「解锁…礼包」类按钮，**绝不点**。
7. **键盘可用（2026-10-23 实测）**：`key 27`(ESC) 能退面板、也能弹退出确认；但全流程仍以鼠标为主，ESC 只用来返回/取消。
8. **以前记下的"本机实测坐标"只作先验**（任务图标 150,258、家园 2258,1518、远征页签 1630,1479、
   打工页签 1972,1479、舰团 1606,1518、委托回收页签 911,1471、提交 1892,1439、提交委托确认 1630,1205、
   一键打工 1980,1492、领取奖励 2341,1492——全部来自 2560×1600 全屏、窗口在 0,0 的一台机器）：
   它们现在只用来给 `locate` 限定 `--region`，**不再作为点击依据**（R4）。换分辨率/窗口模式/DPI 后，
   这些数字只能当"大概在哪一侧"，不能当"点这里"。
9. **提权通道实测可行**：经 DSH 免 UAC 任务 `helper` 模式拉起的 `ps-helper` 点击稳定；但 DSH 每次返回
   工具结果都会把自己带回前台，**先把 DSH 窗口最小化**，否则 `activate` 之后点下去的落点是 DSH 而不是游戏。
   抢前台后一定要重新抓图 + 重新定位（R1/R3），别用抢前台之前的命中框。
10. **两个"底部"别混（2026-10-30 语义更正）**：主界面 dock 上的「舰团」「家园」是**另一组元素，坐标表里没有**；
    `nav.expedition` / `nav.work` 不是主界面 dock，而是**进「家园」之后**底线上的「远征」「打工」
    （1080p 实测中心 `(1225,995)` / `(1470,995)`）。这两项先验与实测只差 `+2,+6` / `−9,+6` px，属**面板类量级**
    （不是 §9.4 的"例外"，不需要读图取坐标）——但点击仍只认模板命中：
    `nav.expedition` 已验证（score **1.0000**、uniqueness 0.45）→ **可直点**；
    `nav.work` 已验证（score **1.0000**、uniqueness 0.49）→ **可直点**。
11. **同页同形按钮：先看 `regions.json`，不是先上锚点（2026-10-30 新增）**：远征页 4~5 个「完成远征」是
    **像素级同形**，全屏匹配 1.0 仍 `ambiguous`（runnerUp 0.9972 / uniqueness 0.0028）→ exit 2；把窗收成首行
    （`{"exp.claim_one":{"pad":[180,70]}}`，先验 y±70）后 score **0.9995** / uniqueness **0.6442** → exit 0。
    判断口径：**只要"任意一行"（功能等价）→ 紧搜索窗；必须"指定那一行" → 锚点 + offset。**

## 4. 什么时候必须停手

- 截图与 `expect` 对不上（版本更新 / 弹窗挡路 / 界面被改）
- `locate` 连续两次没命中，或 `score < 0.72`（低置信不许点，R7）
- 该步**模板缺失**（`references\templates\<id>.png` 不存在或没登记进 `index.json`）、同形按钮在
  `anchors.json` 里没有条目、或同形页**缺 `regions.json` 条目**（只能全屏 → `ambiguous` → exit 2，R3 / R9）
- 同一目标连点两次画面没变化
- 窗口被遮挡、前台被抢、截图全黑/是旧帧
- 出现 UAC、权限不足、`Windows rejected cursor positioning`
- 出现付费/删除/重置按钮，或需要判断"体力/饭团够不够、要不要继续花"
- 用户说停

> ⚠️ **「连点两次没反应」不等于今天放弃**：按 `../game-daily/engine/adapters.md` §8，改用 harness 的
> computer-use（`mcp__wincu__windows_computer_use_*`）一步一屏手推完剩下的步骤，并在报告里注明哪几步是手推的。
> 手推同样先认屏再点，证据（实时截图）照旧落 `state/`。用户 2026-10-23 明确要求：脚本走不通就用 computer-use
> 把日常做完。

停手时输出：**卡在第几步 / 现在屏幕什么样（截图路径）/ 定位分数 / 建议用户怎么做**。

## 5. 安全与隐私（来自 `../game-daily/engine/safety.md`）

- UAC 一次只弹一个，先讲清为什么；被拒就改给手动清单。
- 只对游戏窗口发输入，执行前校验前台标题。
- 截图/日志只写本地 `state/`；对外交付前遮右下 UID 与非目标窗口。
- 委托/远征次数按 `hi-daily.json` 写的上限，不自作主张多花资源。

## 6. 文件在哪

```
..\game-daily\            家族公共层（引擎文档 + 脚本：probe / coords / locate / layout / run-step / peek）
static\core\              本模块的环境自检与跑法
references\               流程(hi-daily.json)、先验(hi-coords.json / hi-layout.json)、
                          认屏(hi-screens.md)、参考图(screens\)、定位模板(templates\<id>.png；
                          同形按钮另有 templates\<id>.anchor.png；别名表 index.json；偏移表 anchors.json)
state\                    本机运行态：coords.local.json、env-<date>.json、runs\<date>.json、shots\<date>\、helper.pid
```
`state/` 不要复制给别人，也不要把本机校准值/自截模板写回 `references/`。
