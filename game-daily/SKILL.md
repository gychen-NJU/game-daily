---
name: game-daily
description: >-
  米哈游系游戏「每日日常」的统一入口（family hub）。用户说"帮我清日常 / 做一下每日 / 每日任务 /
  按文档帮我操作一遍"并提到具体游戏时，先按关键词路由到对应子模块：
  崩坏3 / 崩三 / 崩坏 3 → game-daily-hi；星穹铁道 / 星铁 / 崩铁 / 铁道 / 崩坏星穹铁道 → game-daily-sr；
  绝区零 / ZZZ → game-daily-zzz（暂停中，只做文档不实操）。
  本 skill 不直接执行任何点击：它只负责选模块、讲清公共约定（§2.2 的 R1–R9「定位优先、无证据不点击」、
  环境自检、安全红线、状态目录），然后把活交给子模块的 SKILL.md。
  铁律：点击位置只能来自视觉定位引擎（scripts/locate.mjs），坐标表只作搜索先验；面板类 UI 按宽度等比缩放
  （1080p 相对 1600p 是 0.75，不是 0.675），弹窗不遵守任何单一比例律、只能模板定位；
  截图、认屏文案、定位分数任一不过关就停手，不猜、不盲点。脚本走不通时（同一坐标连点两次无反应、
  或鼠标被过滤但键盘有效，如星铁进游戏后的面板），按 §2.4 与 engine/adapters.md §8 改用 harness 的
  computer-use（mcp__wincu__windows_computer_use_*）逐屏手推完当天日常——同样必须先认屏、后点击。
---

# game-daily · 家族入口

## 1. 先路由（一句话判定）

| 用户提到的词 | 子模块 | 状态 |
| --- | --- | --- |
| 崩坏3、崩三、崩坏 3、BH3 | `game-daily-hi` | ✅ 可执行（14 步已实测）；模板已就位（`references/templates/`，含 `index.json` 外观变体 + `anchors.json` 锚点偏移） |
| 星穹铁道、星铁、崩铁、铁道 | `game-daily-sr` | ✅ 流程已实测（14 步）；**无模板资产** → 点击一律走 computer-use 手推（§2.4） |
| 绝区零、ZZZ | `game-daily-zzz` | ⏸ 暂停：键鼠注入被 ACE 拦，只维护文档 |
| 只说了"日常"、没点名游戏 | — | **问一句**："哪个游戏？" |

路由后**立刻加载对应子模块的 SKILL.md**，按它的步骤走。本文件不再重复步骤。

## 2. 公共约定（所有子模块共享）

### 2.1 先自检环境，再动手

```powershell
node ..\game-daily\scripts\probe.mjs --game <hi|sr|zzz> --pretty
```

看这几样：

- `screen`：整屏物理像素（**只是背景信息，不是坐标系**，见 R8）；
- `foreground` / `game[]`：游戏窗口的标题、hwnd、是否 elevated；
- `helper`：提权助手是否在跑；
- `adapterHints`：**有原生 computer-use → native／DSH 有 wincu 插件 → wincu／都没有 → ps-helper**。

**窗口客户区**（真正要用的坐标系，R8）由 `scripts/locate.mjs` 的抓图字段 `capture.window` 与
`capture.clientOrigin` 给出——它抓的就是客户区，坐标原点 = 客户区左上角。

判定与安装细节：`engine/adapters.md`。**不要假设自己一定有电脑操作能力**：没有就先把
"装什么、怎么装、装完怎么验"讲给用户，再继续。

#### 动手前必须记录环境（`state/env-<date>.json`）

每轮日常开始前，把下面四样记进 **`<模块>\state\env-<YYYY-MM-DD>.json`**（一次写入即可，换天换文件）：

```json
{
  "date": "<YYYY-MM-DD>",
  "client": { "w": 0, "h": 0 },
  "aspect": "16:9",
  "dpiScale": 1.0,
  "gameUiScale": "未改动 / 已调整为 ...",
  "screen": { "w": 0, "h": 0 },
  "adapter": "native | wincu | ps-helper"
}
```

- `client`：窗口客**户**区宽高（不是整屏）——取 `locate --window` 的 `capture.window`；
- `aspect`：`client.w / client.h` 的最简比（16:9 / 16:10 / 21:9 / 其他）；
- `dpiScale`：系统显示缩放（100% = 1.0；125% = 1.25），与 probe 的 `screen.dpiAware` 一起确认；
- `gameUiScale`：游戏内设置里的 **UI 缩放 / 画面分辨率** 有没有动过（动了就要按 §2.2 尺度律重新判断）。

**降级规则（重要）**：客户区**不是 16:9**（4:3、21:9、带黑边），或 **DPI ≠ 100%** 时，
所有坐标先验（`*-coords.json` / `*-layout.json` / `coords.local.json`）一律**降级为"搜索窗口"**：
只能用来给 `locate --region` 提供候选中心，**不能当点击依据**（R4）。不确定区域就别带 `--region`，全客户区搜。

### 2.2 定位优先、无证据不点击：R1–R9 强制协议

这是全家族最硬的约定，优先级高于"把流程跑完"。规则编号固定（R1–R9），子模块与报告里直接引用编号。

#### 为什么改（旧做法为什么会点空）

旧版是「rx/ry 比例换算 + 绝对坐标表」：`x = rx × 屏宽`、`y = ry × 屏高`，再把结果当点击坐标。
这套只在两个前提同时成立时才对：

1. 基准分辨率一致（模块里的值来自一台 2560×1600 的机器）；
2. 游戏 UI 在两轴上**同比缩放**。

实际上崩坏3/星铁的 UI 是**贴边锚定**的：按钮跟着边角走，不同宽高比下相对位置会变（16:10 录的值放到
16:9 / 21:9 上整体偏移），窗口模式与 DPI 缩放再叠一层误差。于是出现"看起来该点那儿，其实点在空白上"，
而且点空之后画面没变化，很容易被误判成"连点两次没反应"。

新协议：**界面身份用文案确认（R2），目标位置用视觉定位（R3），坐标表只用来缩小搜索范围（R4）。**
坐标表还有用，但它从"点击依据"降级成"搜索先验"。

#### 规则

| 编号 | 强制要求 | 违反即 |
| --- | --- | --- |
| **R1** | 每步点击前、点击后**各拿一张实时截图**（不得复用上一轮或旧图），并用 `scripts/probe.mjs` 报告屏幕/窗口信息；坐标与客户区一律以本次输出为准。 | 用陈旧画面做决策 = 拿别的界面的坐标点现在的屏 → 立即停手 |
| **R2** | 屏幕身份靠**必见文案/版式**确认（子模块 `<m>-screens.md` 的 expect 文案），**不靠坐标**。文案不符 → 不点，先做导航步骤或按该步 `onMismatch` 处理。 | 认错屏就点 = 在未知界面上乱点 |
| **R3** | 目标位置**一律**由定位引擎给出：`node ..\game-daily\scripts\locate.mjs --window "<窗口标题>" --template "references\templates\<id>.png" --threshold 0.72 [--region x,y,w,h] --json`。同一 id 允许多个外观变体（`templates\index.json`），逐个试、**取最高分**。`score < 阈值`（默认 0.72）= 未找到（exit 2），**不允许点击**；只允许**重试一次**（可收紧 `--region`、确认窗口仍在前台）；仍失败 → 按 `onMismatch` 处理（**stop 优先**）。 | 低分硬点 = 拿"大概是这儿"当证据 |
| **R4** | 坐标表（`references/<m>-coords.json` / `references/<m>-layout.json` / `state/coords.local.json`）**只允许用于两件事**：给 `locate` 限定 `--region`；定位失败时排查。**禁止**直接用表里的 x,y 点击。 | 用坐标表点 = 本协议要消灭的那件事 |
| **R5** | `state/coords.local.json` 按分辨率标签使用：每条必须带 `screen: {w,h}`（客户区尺寸）；与当前客户区不符或缺该字段 → **视为未校准，不得使用**。 | 跨分辨率混用先验 = 把偏移带进来 |
| **R6** | 每次点击都留证据：`state/shots/<date>/<step>-<n>-before.png`、`...-after.png`，并把 locate 的 `score / scale / cx / cy / 换算后的屏幕坐标` 记进 `state/runs/<date>.json`。 | 没证据 = 无法复盘、无法判断是否点空 |
| **R7** | 低置信（score 不够）、文案不符、窗口不可见/被遮挡/在前台被抢、截图异常（全黑/旧帧/缩放异常）→ **停手报告**，不得猜、不得连点。 | 猜一次就可能误点付费/删除按钮 |
| **R8** | 分辨率与宽高比无关性：几何一律以**窗口客户区**为坐标系（不用整屏，不假设 16:10、不假设 2560×1600）；1920×1080 / 2160×1440 / 3440×1440 / 2560×1600 都必须成立。点击需要屏幕坐标时按 `屏幕 = capture.clientOrigin + 客户区坐标` 换算。 | 拿整屏坐标当客户区坐标 = 整体偏移 |
| **R9** | **同形按钮禁止用坐标先验直接点**。同一屏出现多个同形按钮的 id（`tasks.coin_go`、`tasks.clan_go`、`tasks.material_go`、`exp.claim_one`、`comm.submit` …），先验只代表"某一天的某一行"；换分辨率、隔天列表内容变化、列表滚动都会错位。必须用**锚点模板 + 偏移**，且**锚点必须全屏搜**（锚点文字离目标约 402 px，拿目标的先验去 `--region` 会把它切掉）：① locate `<id>.anchor.png` 得 `(cx,cy)` 与 `scale`；② `目标 = (cx,cy) + (dx,dy) × scale`，`(dx,dy)` 从 `templates\anchors.json` 读（单位 = 1080p 客户区像素）；③ `anchors.json` 缺该 id → **停手补表**，不得用坐标顶替；④ 单模板全屏匹配也不行（同形按钮会命中别的行）。**唯一性由 locate 自己把关**：即使自匹配 1.0，只要 `ambiguous=true`（runnerUp 逼近，如 `exp.claim_one`: runnerUp 0.9972 / uniqueness 0.0028）就 **exit 2 拒点**——分数高 ≠ 唯一。**R9 不等于"必须锚点"**：同页同形且"任意一行都行"（功能等价）时，优先 `templates\regions.json` 紧搜索窗；只有"必须点指定那一行"才用锚点。 | 按行号猜位置 = 点错行（可能点到「解锁礼包」旁边那个按钮） |

#### 工具契约（命令、字段、退出码都以这里为准）

`scripts/locate.mjs`（由 `scripts/locate.mjs` 提供；底层定位引擎为 `scripts/locate.ps1`）：

```powershell
node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" `
  --template "references\templates\<id>.png" `
  --threshold 0.72 `
  [--region x,y,w,h] `
  --json
```

- 输出：`{ok, found, score, scale, x, y, cx, cy, region, template, image, capture{method, window, clientOrigin}, ambiguous, runnerUp, uniqueness, ...}`
- `x,y` = 命中框左上角；`cx,cy` = 命中框中心（**点这个**）；均相对**客户区**左上角。
- **唯一性**：`ambiguous=true`（`runnerUp` 逼近、`uniqueness` 很低）时按未找到处理——**分数高 ≠ 唯一**，
  同形按钮靠消歧解决（紧窗 / 锚点），不许降阈值硬点。
- `--region` 是**消歧手段**（把搜索窗收窄、抬高 uniqueness），**不是"降级成盲点"**：窗内找不到照样 exit 2。
- 退出码：`0` = 命中；`2` = 未找到**或重名 ambiguous**（fail-closed，**这就是"不许点"的信号**）；`1` = 参数/文件错误（例如模板不存在）。
- 点击决策**必须**用 `--window` 形式（它自带抓图并给出 `capture.clientOrigin`）。`--image` 形式只用于离线排查——
  没有 `clientOrigin`，无法换算屏幕坐标，不得作为点击依据。

`scripts/layout.mjs`（锚点模型，由 `scripts/layout.mjs` 提供）：

```powershell
node ..\game-daily\scripts\layout.mjs resolve `
  --layout "references\<m>-layout.json" --screen <客户区WxH> --item <id> --json
node ..\game-daily\scripts\layout.mjs resolve --layout "references\<m>-layout.json" --screen <客户区WxH> --all --json
```

- 输出：`{id, x, y, screen:{w,h}, scale, anchor, offset:{dx,dy}, scaleMode, clamped, ...}`。
- 用途**只有一个**：`x,y` 作为 `--region` 的中心去限定搜索窗。`clamped: true` 说明该点已贴边，区域要给够余量。
- 不确定怎么取区域时**就不带 `--region`**（全客户区搜索，慢一点但不会把目标切掉）——宁可慢，不要切。
- 模型的字段语义、offset 单位、`check/fit/export` 用法见 `engine\layout.md`（由 layout-model 维护）。

`references\templates\` 的两个索引（模块发布物，定位前先读）：

`index.json` — 同一 coord id 允许**多个外观变体**，locate 逐个试、取最高分：

```json
{ "dialog.ok": ["dialog.ok.png", "popup.ok2.png"],
  "popup.ok2": ["popup.ok2.png", "dialog.ok.png"] }
```

> 为什么需要：签到弹窗的「确定」带 ✓ 图标、领取奖励弹窗的「确定」不带 —— 同一个 id 两种外观。
> 只配单一模板时另一种外观实测只有 **0.579**（< 0.72 被拒，fail-closed 停手）；配上变体后同图 **1.0**。
> 新增外观只需加 png 并在 `index.json` 挂上，不改代码。

`anchors.json` — R9 的锚点+偏移表：

```json
{ "tasks.coin_go": { "anchor": "tasks.coin_go.anchor.png", "dx": 402, "dy": 98 } }
```

- `dx,dy` 单位是 **1080p 客户区像素**；命中给 `scale` 时按 `(dx,dy) × scale` 缩放；
- 缺条目 = 该步不可执行（R9），先补 png + 条目；
- 2026-10-30 实测：作战任务页四行「前往」（金币采集 / 舰团委托 / 材料活动 / 家园打工）偏移一致 `(+402,+98)`。
- **分数高 ≠ 唯一**：`exp.claim_one` 自匹配 **1.0**，但 `ambiguous=true`（runnerUp **0.9972**、uniqueness **0.0028**）
  → `locate` **exit 2 拒点**。同页 4~5 条远征按钮**像素级同形**，单模板天然分不清 —— 这不是调阈值能解决的，
  必须消歧：**要"任意一行"用紧搜索窗（`regions.json`，见下）；要"指定那一行"才用锚点（`anchors.json`）**。

`regions.json` — 同页同形按钮的**紧搜索窗**（第三种消歧手段，2026-10-30 新增）：

```json
{ "exp.claim_one": { "pad": [180, 70], "note": "远征页 4~5 行同形「完成远征」→ 用首行紧窗消歧（先验 y±70 只含一行）" } }
```

- `pad` = 搜索窗的**半宽 / 半高**（单位 = **当前客户区像素**，不乘 scale）；窗 = 先验 `(x,y) ± pad`，clamp 到客户区；
  由 `scripts/run-step.mjs` 的 `layoutRegion()` 读取；**缺条目 / 坏表 → 退回默认 ±320**（同形页仍会 ambiguous）。
- 只用于"**任意一行功能等价**"的目标；要指定某一行 → 锚点+偏移（`anchors.json`）。
- 实测：`exp.claim_one` 全屏 `score 1.0` 但 `ambiguous`（0.9972 / 0.0028）→ exit 2；加 `pad [180,70]` 后
  `score` **0.9995** / `uniqueness` **0.6442** / `ambiguous=false` → **exit 0**。

**三种消歧手段的适用顺序**（按顺序判断，别一律上锚点）：

1. **外观不同**（灰/亮态、弹窗两种皮肤）→ `index.json` 外观变体，逐个试取最高分；
2. **必须点指定那一行/那一项**、位置随内容漂移 → `anchors.json` 锚点 + `offset × scale`（锚点**全屏**搜）；
3. **同页同形、任意一行都算完成**（功能等价，如任意一行远征）→ `regions.json` 紧搜索窗。
   三者都不是"降级成盲点"：窗内找不到 / 锚点没命中，照样 exit 2 停手。

#### 分辨率指纹：分辨率不变就复用上次经验（2026-10-30 新增）

`scripts/resolution.mjs` 维护 `<stateDir>/resolution.json`（`current` + `profiles.<WxH>.hits`），
**只在定位命中时写入**（失败不写，避免把坏先验存下来）。`run-step.mjs` 开场打印一行 `[分辨率指纹] …`：

- `分辨率未变（WxH）→ 复用 N 条历史命中先验`：该分辨率下命中过的目标，搜索窗收窄为
  `±(170 × 客户区H/1080)`（1080p ±170、1600p ±252）。**仍然必须模板命中且过阈值**，
  收窄只影响"去哪儿找"——更少全屏扫描、更快更稳。
- `分辨率变了：A → B → 旧先验作废`：旧分辨率的位置一律不用，按新尺寸重新定位。
  跨分辨率命中会由 locate 自动缩放模板：实测 1080p 裁的模板在 2560×1600 以 `scale≈1.33` 命中，
  `tasks.open` 分数 0.74~0.79（重采样损耗，仍过 0.72），`game.click_anywhere` 0.9764。
- 怀疑先验把搜索带偏（隔天列表大改、相邻行同形）时加 `--no-priors` 关掉复用、回到默认 ±320。
- 先验只是搜索窗：**点不点仍由当场模板命中 + `ambiguous` 决定**；不要手改 `resolution.json` 伪造先验。

`scripts/coords.mjs resolve`（旧接口，只作先验/排查）：

```powershell
node ..\game-daily\scripts\coords.mjs resolve <id> --game <hi|sr> --screen <客户区WxH> --json
```

- 输出：`{id, x, y, source, note}`，`source` ∈ `local` / `relative` / `absolute(legacy)`。
- 它给出的 `(x,y)` **不是**点击坐标；只用来理解"大概在哪"和排查定位失败。

#### 尺度律（2026-10-30 · 崩坏3 1080p 实机实测）

崩坏3 的界面**不是整体等比缩放**，按三类分别处理：

| 类型 | 规则 | 实测证据（2560×1600 → 1920×1080） |
| --- | --- | --- |
| **面板类 UI**（主界面、任务页、远征页、舰团页、材料页里的按钮/页签/标题） | 按**宽度**等比缩放：`k = 客户区W / 1920`（1080p 时 k = 1.0；相对 2560 宽 k = 0.75 = 1920/2560，**不是**高度比 0.675）；顶部锚定 → `y` 同样 `× k` | 主菜单 (466,72) → (349,53)：466×0.75 = 349.5、72×0.75 = 54；一键领取 (2350,238) → (1762,180)：2350×0.75 = 1762.5、238×0.75 = 178.5；按钮尺寸 323×87 → 242×65（242/323 = 0.749、65/87 = 0.747）。**残差**：宽比律 5/5 可比元素 ≤1.5px；换成高比律同组有 5 项 >15px |
| **贴底元素**（**家园底栏**的「远征 / 打工」，及其上方的「一键远征」「领取奖励」「一键打工」等；注意：主界面 dock 的「舰团 / 家园」是**另一组元素、不在坐标表内**，别混） | 按**底边**锚定 + 宽度缩放：`y = H − (H₁₆₀₀ − y₁₆₀₀) × k`；`x` 仍按宽度律 | 每日历练值条：1600p y = 1492 → 1080p y = **999**；若误按顶部锚定（1492×0.75 = 1119）会错 **120 px**。对应 `<m>-layout.json` 里 `bl / bc / br` 锚点的条目 |
| **弹窗**（奖励 / 确认 / 结算弹窗里的「确定」类按钮） | **不遵守任何单一比例律** | `dialog.ok` 1080p **实测 (959,797)**：x 符合宽度律（1280×0.75 ≈ 960）；y 用两种律外推（814 / 786）都不等于 797，且它和 `popup.ok2` 只差 23 px → **弹窗按钮只能模板定位** |

**naive `rx/ry` 的实证误差**：主界面左列「任务」图标 1080p 实测 x ≈ 88，按 `rx` 换算得 113（偏 25 px，真实位置是贴左内缩）——比例法连"看起来最稳"的贴边元素都会偏，别指望它兜底。

结论：**能算出来的值也只用来限定 `--region`（R4），不能拿去点**；算不出来的（弹窗、行内按钮）只能靠模板（R3 / R9）。
这也是 §2.3 "绝不点付费礼包" 的技术前提：付费按钮常与「一键领取」同屏同形，只有模板能区分。

> ⚠️ 对 `references\<m>-layout.json` 的影响（供 layout-model / Lead 复核）：当前 `hi-layout.json` 的 34 项
> **全部**是 `scaleMode: "height"`，而面板类 UI 实测是**宽度**律 → 面板类条目应改 `scaleMode: "width"`；
> 贴底条目用 `bl / bc / br` 锚点 + `width`；弹窗**不要**进 layout（只留模板）。判定顺序：先按本表分类，再选 scaleMode。

#### 证据落盘（R6）

| 文件 | 内容 |
| --- | --- |
| `state/shots/<YYYY-MM-DD>/<step>-<n>-before.png` | 点击前截图 |
| `state/shots/<YYYY-MM-DD>/<step>-<n>-after.png` | 点击后截图 |
| `state/runs/<YYYY-MM-DD>.json` | 追加本次点击记录：`step / n / ts / id / template / found / score / scale / cx / cy / screenClick{before,after} / verify` |
| `state/env-<YYYY-MM-DD>.json` | 本轮环境：客户区 / 宽高比 / DPI 缩放 / 游戏内 UI 缩放（见 §2.1） |

`<n>` 是同一 step 内的顺序号（1 起）。`run-step.mjs --ps` 也写同名文件，追加时不要覆盖已有数组。
失败/停手同样要记：`found=false` 时的 `score` 是最有价值的排查数据。

### 2.3 安全红线（不过就停）

- UAC 一次只弹一个，先讲清为什么；被拒 → 改给手动清单，不重试。
- 只对目标游戏窗口发输入；每批点击前校验前台标题。
- **绝不点**付费礼包（"解锁…礼包"）、删除、重置这类按钮。
- 截图/日志只写本地 `state/`；对外交付遮角色 UID 与无关窗口。
- 同一坐标连点两次画面无变化 → 停手，别硬刷。
- 低置信定位、认屏文案不符、窗口被遮挡或前台被抢 → 停手报告（R7），不猜。

### 2.4 脚本走不通 → 换 computer-use 手动推（**用户明确要求，别硬刷**）

只要出现下面任一条，就说明"坐标点击这条路对这个游戏失效了"，**立刻停手**：

- 同一坐标连点两次、画面毫无变化（不是坐标偏，是界面不响应）；
- 鼠标点了没反应但**键盘有效**（本机星铁就是：`key 115` 能开「星际和平指南」，用 `ps-helper` 的合成点击
  点页签/「前往」全无反应——**被过滤的只是合成鼠标；harness 的 computer-use 能正常接管，已实测跑通**）；
- 脚本/探针明确报"该窗口拒绝合成输入"；
- **缺该步的模板**（`references/templates/` 没有这个 id 的 png；或同形按钮在 `anchors.json` 里没有条目；
  或同形页缺 `regions.json` 的 `pad` 条目 → 只能全屏 → `ambiguous` → exit 2）：
  这不算"脚本走不通"，但同样**不能退回坐标点击**——要么按本节的 computer-use 手推，要么先补模板/补 offset/补 pad
  再跑（新增外观只需加 png 并在 `index.json` 挂上，不用改代码）。

此时**不要放弃这一天的日常**，改把 harness 的 computer-use 当"手"、把步骤表当"导航"，一步一屏推完：

```
windows_computer_use_screenshot(windowTitle="星穹铁道|崩坏3")  →  read_image 判读
→  windows_computer_use_click / keypress  →  再截图复检  →  记下这一步
```

要点：① 每步都带 `windowTitle`，否则截到的是抢回前台的 DSH；② 目标窗口是管理员权限时
`click` 可能被 UIPI 拦，改走 `keypress` 或回 ps-helper；③ 常规 Windows 窗口（启动器/登录框）
用 `snapshot`+`find`+`invoke` 比点像素稳；④ 收工在报告里写清"哪几步是 computer-use 手推的"；
⑤ 手推时"证据"= 实时截图 + 认屏文案 + 点后复检图（同样落 `state/`），**不是**"凭记忆点像素"。

完整切换判据、工具映射与红线：`engine/adapters.md` §8，以及 §9（定位优先怎么落到各适配器）。

### 2.5 每步的通过条件（检查清单模板）

子模块的步骤表可以照这个格式写"可判定"的通过条件；跑的时候逐条勾：

- [ ] **R1**：本步 `before` 截图是本轮刚抓的；`probe` 的屏幕/窗口信息与预期一致（前台是游戏、窗口可见）。
- [ ] **R2**：该步 `expect` 的必见文案在 before 图里**全部**看到（对照 `<m>-screens.md`）。
- [ ] **R3**：点击目标的 locate 输出 `found=true` 且 `score ≥ 0.72`，`score/scale/cx/cy` 已记录。
- [ ] **R9**（仅同形按钮步）：用的是**锚点模板 + offset×scale**，不是坐标先验；offset 来自 `anchors.json`（1080p 像素）且已标定；锚点是**全屏搜到**的（没套目标先验的 `--region`）。若"任意一行都行"，改用 `regions.json` 的 `pad` 紧窗，并确认窗内 `ambiguous=false`、`uniqueness` 明显抬升。
- [ ] **R8**：点击坐标 = `capture.clientOrigin + cx,cy`；前台仍是目标窗口（R7）。
- [ ] **R6**：`after` 截图存在，且该步 `verify` 文案出现（或数值确实变了：历练值/水晶/剩余次数）。
- [ ] **R6**：记录已写进 `state/runs/<date>.json`。

任何一条打不上勾 → 按 R7 停手，别继续下一步。

## 3. 执行循环（三模块通用）

**截图（R1）→ 认屏（R2）→ 定位（R3/R9）→ 点击 → 复检（R6）**，任何一拍对不上就停（R7）。

```powershell
node ..\game-daily\scripts\run-step.mjs --game <m> --step N   # 打印计划（只作导航，不动鼠标）
node ..\game-daily\scripts\run-step.mjs --game <m> --all      # 全流程计划
```

- 计划里打印的 `(x, y)` 是**先验**（来自坐标表/布局解析），只帮你理解"大概在哪"，**不得直接点击**（R4）。
- `--ps` 不带 `--locate` = 按先验坐标**盲点**（违反 R4，运行时会打印警告）：只留作排障，日常不用。
- `run-step.mjs` 的定位开关（2026-10-30 新增）：

  | 开关 | 行为 | 退出码 |
  | --- | --- | --- |
  | `--locate` | 每个 click **先实时截图 → 定位 → 过阈值才点**（`--threshold`，默认 0.72）；任一步不过即 fail-closed，不点 | `0` 全过 / `3` 有步失败（已停） |
  | `--probe` | **只截图 + 定位，绝不点击**；打印每步 `via / score / scale / client / region / shot`（演练、巡检用） | `0` 全过 / `2` 任一步未命中 |
  | `--anchor-only` | 跳过直接模板、只走 anchor+offset（排障：验证 `anchors.json` 是否真的能命中） | 同上 |

  定位优先级（`--locate` / `--probe` 共用）：① 直接模板（`index.json` 里该 id 的全部变体，先验只用来缩 `--region`；
  同形页的窗由 `templates\regions.json` 的 `pad` 收窄）→ ② 锚点模板**全屏**搜索 + `offset × scale` → ③ 都失败 → 停手（exit 3 / 2），**不退回坐标点击**。
- 真正的点击：ps-helper 路径下把 locate 的 `clientOrigin + cx,cy` 写进 `cmd.txt` 的 `click`；native/wincu
  由 agent 自己调用对应工具，坐标同样来自 locate。
- `engine/runbook.md` 已同步到本节（2026-10-30）：五拍 = 截图 → 认屏 → 定位 → 点击 → 复检。

## 4. 目录约定

```
game-daily/                  ← 本文件（入口）+ engine/ + scripts/
game-daily-hi/               ← 崩坏3 模块
game-daily-sr/               ← 星铁模块
game-daily-zzz/              ← 绝区零模块（暂停）
```

每个模块：`SKILL.md` / `manifest.yaml` / `references/<m>-daily.json` / `references/<m>-coords.json` /
`references/<m>-layout.json` / `references/<m>-screens.md` / `references/screens/` /
`references/templates/` / `state/`。

- `references/templates/<id>.png`：**定位模板**，R3 的唯一输入；缺模板 = 该步不可执行（停手，禁止退回坐标点击）。
- `references/templates/<id>.anchor.png`：**锚点模板**（R9），用来量"锚点中心 → 按钮中心"的偏移，不直接点。
- `references/templates/index.json`：**模板别名表**——同一 id 允许多外观变体，locate 逐个试取最高分。
- `references/templates/anchors.json`：**R9 锚点+偏移表** `{anchor, dx, dy}`，`dx,dy` = 1080p 客户区像素。
- `references/templates/regions.json`：**同形按钮紧搜索窗表** `{"<id>":{"pad":[半宽x,半宽y]}}`，`pad` = 当前客户区像素、
  覆盖 `layoutRegion()` 默认 ±320；用于"任意一行都行"的同形页（缺条目 → 退回 ±320 → ambiguous → exit 2）。
- `state/coords.local.json`：本机私有先验，R5 要求每条带 `screen: {w,h}`。
- `state/shots/<date>/`、`state/runs/<date>.json`、`state/env-<date>.json`：R6 证据 + §2.1 环境记录。

engine 文档分工：`adapters.md`（三条执行路径 + §9 定位落地）、`calibration.md`（先验与模板自检）、
`layout.md`（锚点模型字段与 offset 单位）、`runbook.md`（五拍）、`safety.md`（红线）。

## 5. 加新模块（扩展点）

1. 复制 `game-daily-hi/` 为 `game-daily-<new>/`
2. 写 `references/<new>-daily.json`（步骤 + expect + verify + onMismatch）、`<new>-coords.json`、
   `<new>-layout.json`、`<new>-screens.md`，并为每个会点的 id 准备 `references/templates/<id>.png`
   （同形按钮还需 `<id>.anchor.png` + 1080p 标定的 offset，或 `regions.json` 的 `pad` 紧窗——见 §2.2 三种消歧手段）
3. `probe.mjs` 的 `GAMES` 表加一行（launcher / game 进程名）
4. 自检：`coords.mjs check --game <new>` 的 `missing=0`、`layout.mjs check` 通过、`run-step.mjs --all`
   能出全流程，且每个 id 的模板都能 `locate` 到 `score ≥ 0.72`、每个 `*.anchor.png` 在 `anchors.json`
   里有已实测条目；最后跑 **`run-step.mjs --probe --all`，必须 exit 0**（全定位通过、零点击）
5. 在本文件的 §1 路由表加一行
