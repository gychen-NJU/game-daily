# 坐标校准与定位自检（calibration）

> 本文件回答一件事：**换机 / 换分辨率 / 换窗口模式后，怎么让"先找后点"仍然可靠。**
> 规则编号与硬约束见 `SKILL.md` §2.2（R1–R9）；这里只讲落地操作。
>
> **核心变化（务必先读）：** 旧版校准是"量出一个点，存进 `coords.local.json`，以后按这个坐标点"。
> 现在那条链路被 R4 切断——坐标表**不再是点击依据**，只用来给 `locate` 限定 `--region`。
> 所以本机的"校准"工作从"记坐标"变成两件事：
> **① 确认客户区尺寸并给先验打上分辨率标签（R5/R8）；② 确认每个 id 的模板/外观变体在本机能命中（R3）；③ 确认同形按钮的锚点偏移表可用（R9）。**

## 1. 为什么旧办法会偏（一句话版）

`x = rx × 屏宽` / `y = ry × 屏高` 只在**基准分辨率一致**且 **UI 两轴同比缩放**时成立。
米哈游系 UI 多为**贴边锚定**（按钮跟随边角），16:10 记的比例放到 16:9 / 21:9 上会整体偏移；
窗口模式与 DPI 缩放再叠一层误差。偏十几像素就可能点在按钮边缘外，画面没变化 → 误判"连点两次没反应"。
**视觉定位（模板匹配）对这类偏移不敏感**，只要模板在客户区里出现、分数够，就能点准。
量化：1080p 实测中面板类按宽度比（0.75 = 1920/2560）5/5 可比元素残差 ≤1.5 px；换高度比（0.675）同组有 5 项 >15 px。

## 2. 坐标系与文件分工

| 对象 | 路径 | 角色 | 谁维护 |
| --- | --- | --- | --- |
| 窗口客户区 | `locate --json` 的 `capture.window` / `capture.clientOrigin` | **唯一坐标系**（原点=客户区左上） | 运行时自动给出 |
| 全局先验 | `references/<game>-coords.json` | 出厂参考坐标（base 分辨率），只用于 `--region` | 模块作者 |
| 布局先验 | `references/<game>-layout.json` | 锚点模型（贴边/居中/按高缩放），只用于 `--region` | 模块作者 |
| 本机先验 | `state/coords.local.json` | 本机实测先验，**每条必须带 `screen`（R5）** | 本机（我） |
| 定位模板 | `references/templates/<id>.png` | R3 的唯一输入，**模块发布物** | 模块作者 |
| 外观变体表 | `references/templates/index.json` | 同一 id 多个外观，逐个试取最高分 | 模块作者 |
| 锚点偏移表 | `references/templates/anchors.json` | R9：`{anchor, dx, dy}`，`dx,dy` = 1080p 像素 | 模块作者 |
| 紧搜索窗表 | `references/templates/regions.json` | 同页同形消歧：`{"<id>":{"pad":[半宽x,半宽y]}}`，单位=当前客户区像素、覆盖默认 ±320 | 模块作者 |
| 参考截图 | `references/screens/*.png` | 认屏（R2）用，不参与定位 | 模块作者 |
| 证据 | `state/shots/<date>/`、`state/runs/<date>.json` | R6 | 每次运行自动写 |

三条纪律：

1. **绝不把本机值写回 `references/`**（那是发布物，写回会污染别人的机器）。
2. **绝不自己截一张图当模板**（模板错位/带背景/带水印，会让所有机器一起点空）。缺模板 → 报给模块作者补。
3. `state/` 可以整目录删掉重建（那是本机缓存），删之前确认当天没有在跑的流程。

## 3. 什么时候要重新自检

- 换机器、换分辨率、改窗口化/全屏、改系统 DPI 缩放比例；
- 游戏大版本更新（UI 改版）；
- 某步 `locate` 从"稳定命中"变成"时灵时不灵"；
- 上一次运行以 `found=false` 或 `score < 0.72` 停手；
- 第一次在本机跑（`state/` 为空）。

## 4. 自检流程（新机器/新分辨率，按顺序走）

### 4.1 拿客户区尺寸，别用整屏

```powershell
node ..\game-daily\scripts\probe.mjs --game hi --pretty        # 整屏尺寸：背景信息
node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" --template "references\templates\tasks.open.png" --json
```

读 `capture.window`（应为 `{w,h}` 客户区）与 `capture.clientOrigin`（客户区左上在屏幕上的位置）。
**后面所有 `--screen` 参数都填这个 `w x h`**，不是整屏尺寸（R8）。

> 常见坑：全屏 2560×1600 时客户区通常就是 2560×1600；但**窗口化 / 无边框窗口**时会小一圈
> （标题栏、边框、或游戏自己留的黑边），此时整屏值直接拿去算就是偏移的来源。

### 4.2 给先验打分辨率标签（R5）

```powershell
node ..\game-daily\scripts\coords.mjs resolve tasks.open --game hi --screen <客户区WxH> --json
```

- 输出 `source: local` 表示本机值；`relative` / `absolute(legacy)` 表示退回出厂值（**只作线索**）。
- **R5 要求**：`state/coords.local.json` 里每条都要有 `screen: {w,h}`。当前 `coords.mjs set` 只写顶层
  `base`，**不写每条的 `screen`** → 新记的值要手动补上这一个字段：

  ```json
  {
    "game": "hi",
    "base": { "w": 2560, "h": 1600 },
    "items": {
      "tasks.open": { "x": 150, "y": 258, "screen": { "w": 2560, "h": 1600 }, "note": "主界面左上任务图标（2560×1600 全屏）" }
    }
  }
  ```

- 用法：**只有 `screen` 与当前客户区完全一致的那条才可用**（当 `--region` 线索）。不一致 = 未校准，
  当作没有这条先验（不影响流程，因为定位会全客户区搜索，只是慢一点）。
- 顶层 `base` 与此不一致时，整个文件只提示"这是另一台机器/另一个分辨率的记录"，不要混用。

### 4.3 逐 id 验证模板能不能命中（R3 的门槛）

**先跑整体演练**（只截图 + 定位、绝不点击；全过 exit 0、任一未命中 exit 2）：

```powershell
node ..\game-daily\scripts\run-step.mjs --game hi --probe --all
```

要逐 id 手工核对时，按 `references\templates\index.json` 里该 id 的**全部外观变体**各跑一次、取最高分
（`locate` 一次只认一个 png；变体轮试由 `run-step` 自动做）：

```powershell
node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" `
     --template "references\templates\<id>.png" --threshold 0.72 --json
```

> 2026-10-30 实测：`dialog.ok` 只配 `dialog.ok.png` 时，签到类弹窗的「确定」只有 **0.579**（会被拒）；
> 把 `popup.ok2.png` 挂成别名后同一张图 **1.0** —— 所以"单模板失配"先查 `index.json`，别急着换模板。

判读：

| 输出 | 含义 | 怎么办 |
| --- | --- | --- |
| `found=true`、`score ≥ 0.72` | 可点 | 记下 `score / scale / cx,cy` 进 `state/runs/`（R6） |
| `found=true`、`0.60 ≤ score < 0.72` | 可疑：模板与实机有差异（版本/缩放） | **不点**（R7）。收紧 `--region` 再试一次；仍低 → 报模块作者更新模板 |
| `found=true`、`score < 0.60` 或命中框在别的控件上 | 串模板了（同类按钮并排最常见） | 不点；用 `--region` 限定到正确区域再试一次；仍串 → 报模板问题 |
| exit 2 / `found=false` | 未找到 | 先确认"我在对的界面吗"（R2 文案）；再确认模板文件存在且不属于另一个分辨率/主题；仍不行 → 停手报 |
| exit 1 | 参数/文件错误（如模板路径写错） | 修命令，不要当成"没找到" |

**通过标准**：14 步里每个会点的 id，在本机目标分辨率下都能稳定 `score ≥ 0.72`。
哪个 id 不行，就明确写"该步今天不可执行"，而不是"那我按坐标点一下吧"。

### 4.4 用布局先验缩小搜索区（可选，只为提速）

```powershell
node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen <客户区WxH> --item tasks.open --json
```

输出 `{x, y, anchor, offset, scale, scaleMode, clamped}`。把它当 `--region` 的中心：

```powershell
# 例：以 (x,y) 为中心取 240×160 的搜索窗（数字按目标按钮大小给，不写死成通用值）
node ..\game-daily\scripts\locate.mjs --window "<窗口标题>" --template "references\templates\tasks.open.png" `
     --region <x-120>,<y-80>,240,160 --threshold 0.72 --json
```

- **`clamped: true`** → 该点已经贴边，区域要给够余量，别把目标切出窗外。
- **拿不准就不带 `--region`**：全客户区搜索慢一点，但不会因为区域选错而"找不到"。
- 布局解析只解决"去哪个区域找"，**不解决"点在哪个像素"**——那是定位的事。

### 4.5 验证锚点偏移表（R9）

同形按钮（一屏多个「前往」「领取」）不靠坐标、也不靠单模板全屏匹配，靠 `references/templates/anchors.json`：

```powershell
node ..\game-daily\scripts\run-step.mjs --game hi --step 3 --probe        # 看 via=anchor 的 score/scale/client
node ..\game-daily\scripts\run-step.mjs --game hi --step 3 --anchor-only  # 排障：只走锚点，验证条目本身
```

- 锚点模板 `templates\<id>.anchor.png` 必须是**行标题文字块**，且**全屏搜**（锚点离目标约 402 px）；
- 条目形如 `{ "anchor": "tasks.coin_go.anchor.png", "dx": 402, "dy": 98 }`，`dx,dy` 单位 = 1080p 客户区像素；
- 换分辨率 / 改 UI 缩放后：`scale` 变、`dx,dy` 不变（1080p 标定值），点击 = `(cx,cy) + (dx,dy) × scale`；
- **缺条目 = 该步不可执行**；补条目要真机量（锚点中心 → 按钮中心），不许拿坐标表反推。

2026-10-30 实测：作战任务页四行「前往」偏移一致 `(+402,+98)`；即便目标先验位置偏 402 px，
锚点法仍命中 `(984,381)`、score **1.0**。

### 4.6 验证紧搜索窗表（同形页消歧，`regions.json`）

适用：**同页同形、且任意一行都算完成**（如任意一行远征），不要求点"指定那一行"——那种才用锚点（§4.5）。

```powershell
node ..\game-daily\scripts\run-step.mjs --game hi --step 5 --probe     # 看 region= 是否已是紧窗、ambiguous 是否消失
```

- 条目形如 `{"<id>":{"pad":[180,70],"note":"…"}}`；`pad` = **半宽 / 半高**，单位 = **当前客户区像素**（不乘 scale），
  窗 = 先验 `(x,y) ± pad`，clamp 到客户区；`run-step.mjs` 的 `layoutRegion()` 读取，**缺条目/坏表 → 默认 ±320**。
- 自检判据：全屏时 `ambiguous=true`（exit 2）→ 加紧窗后 `ambiguous=false`、`uniqueness` 明显抬升、`score ≥ 0.72`；
  2026-10-30 实测 `exp.claim_one`：全屏 1.0 但 ambiguous（runnerUp 0.9972 / uniqueness 0.0028），
  `pad [180,70]` 后 **0.9995 / 0.6442 / exit 0**。
- **缺条目 = 该 id 在同形页不可执行**（退回 ±320 必然 ambiguous）；补 `pad` 要真机量（先验 y 到"只含一行"），
  不许拿锚点 offset 或坐标反推。

## 5. 记录要求

- `state/runs/<date>.json` 追加：`{step, n, id, template, found, score, scale, cx, cy, screenClick, verify, ts}`。
  失败也记（`found=false` 时的 `score` 是最有价值的排查数据）。
- `state/shots/<date>/<step>-<n>-before.png` / `-after.png`（R6）：点前点后各一张，**当轮抓的**（R1）。
- `state/coords.local.json`：每条带 `screen` + `note`（写清"哪个界面、什么状态、哪次量的"）。
- 锚点表变更（新增 / 修正 offset）：写清哪一行、锚点坐标、按钮坐标、分辨率；**不许凭坐标表反推**。
- 需要长期留档的（模板问题的证据）另存 `state/calibration.log.md`，一条一行：
  `日期 | 分辨率 | id | score | 现象 | 处理`。**不回写 `references/`。**

## 6. 容易定位错的目标（模板相似、并排、会动）

| 场景 | 为什么难 | 做法 |
| --- | --- | --- |
| 星铁 `guide.task_claim` / `honor.onekey_mission` | 同屏多个"领取"样式相近 | 用 `--region` 限定到右侧任务栏，或换更独特的模板裁切 |
| 星铁 `calyx.plus` / 副本入口 | 按钮小、满屏特效 | 截模板时只取按钮本体，别把特效带进去 |
| 星铁 `dispatch.claim_reward` | 列表项多、滚动后位置变 | 每次点前重新定位，别复用上一次命中框 |
| 所有"点弹窗确认"（崩坏3 `dialog.ok` / `popup.ok2`） | 两种弹窗高度差约 23 px，且「确定」带不带 ✓ 是两种外观 | 用 `index.json` 把两种外观挂到同一 id、逐个试取最高分；只配单模板时签到类弹窗只有 0.579（会被正确拒掉） |
| 行内「前往」（崩坏3 `tasks.coin_go` 等四行） | 同屏多行同形，位置随当日任务行序变化 | **R9 锚点+偏移**（`anchors.json`）；单模板全屏匹配会命中错行 |
| 底部/顶部导航页签 | 贴边锚定，换宽高比偏移最大 | 依赖 `layout.json` 的锚点给区域，或干脆全客户区搜 |
| 会飘的图标（启动器游戏图标、红点） | 位置随安装游戏数变化 | 按外观模板找，别按序号；红点消失是真领到的证据 |

## 7. 出现"定位一直失败"时的排查顺序

1. 窗口**是不是**目标窗口（前台标题、尺寸）？被 DSH 抢前台了吗？（`probe.mjs`）
2. 界面**对不对**（R2 文案）？——在错的页面上找对的控件，分数必然低。
3. 模板**是不是**这个模块的、是不是这个 id 的？路径写对了吗（exit 1）？
4. 游戏**分辨率/DPI** 变了吗（客户区跟上次不一样）？
5. 目标**被遮挡**（弹窗、黑半屏、加载遮罩）？
6. 以上都对仍失败 → **停手报**：贴 `score`、`capture.window`、before 截图。不要用坐标表硬点（R4）。
