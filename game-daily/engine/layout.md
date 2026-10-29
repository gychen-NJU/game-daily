# 锚点布局模型（layout）

> 一句话：把「在某个分辨率上量出来的绝对坐标」改写成「贴哪个边 + 距边多远」，
> 换分辨率 / 换宽高比时先验仍然落在按钮附近。
>
> **它只产出一个东西：`locate --region` 的中心**。产出的 `x,y` **不是点击坐标**（R4），
> 点击位置只能来自 `locate.mjs` 的模板命中（R3）。
>
> 模型定义 → `references/<m>-layout.json`（数据）；计算 / 校验 → `scripts/layout.mjs`（代码）。
> 本文档是这两者的规格说明；改模型先改这里，再改数据，最后跑 §8 的维护流程。
>
> **2026-10-30 起有一份跨分辨率实测**（1080p 实机 vs 1600p 参考图的同一元素各量一次），
> 直接推翻了「按高度缩放」的旧假设：**面板类 UI 是按宽度缩放的（×0.75，不是 ×0.675）**。
> 因此 `scaleMode` 主力从 `height` 改成 `width`（弹窗除外）。实测表与结论在 **§11**，
> 由此得到的正确用法（先定位锚点、再按 offset×scale 推目标）在 **§12**。
> 只想知道"该信多少"的读者，直接看 §9 的置信度表。

## 1. 为什么需要它（而不是继续存比例坐标）

`x = rx × 屏宽, y = ry × 屏高` 只在**基准分辨率一致**且 **UI 两轴同比缩放**时成立。
米哈游系 UI 是**贴边锚定**的：按钮跟着边角走，不跟着画面中心等比放大；而且实测（§11）表明
它**只按宽度缩放**——同一元素在 1080p 上的中心与尺寸都是 1600p 的 0.75 倍。

所以用旧的比例坐标（或按高度缩放的模型）搬到 1920×1080，右上/右下按钮会**往中间偏 16~80px**，
左下/左上会往右上偏——足够让模板匹配的搜索窗切掉一半按钮。

锚点模型的差别只有一句话：**距离不从画面左上角算，从按钮实际贴着的那条边走**；
缩放系数则按**宽度比**取（§3.2）。

## 2. 两套尺寸：base 与 reference

| 名字 | 值 | 含义 | 谁用 |
| --- | --- | --- | --- |
| **base** | 2560×1600 | 坐标**测出来**的那个视口（`hi-coords.json` / `coords.local.json` 的基准） | `derived`、`fit` 反算 |
| **reference** | 1920×1080 | `offset` 的**单位**尺寸（逻辑像素），也是 `k` 的 1× 基准 | 每次 resolve |

`offset` 选 1920×1080 而不是 2560×1600 作单位，是因为**可读性**：`offset.dy = 178.5` 一眼能对上
"1080p 下按钮在顶边往下 178.5px"，而 1600 基准下同一含义要写成 238。两者等价，只是换算。
另外 `width` 模式下 1080p 恰好是 `k = 1`，所以 **`offset` 在 1080p 屏幕上就是像素位移**，
可以直接拿去和 `locate` 的命中中心相加（§12）。

`base` 可以在布局文件里省掉（此时等于 `reference`），但 hi 这份必须写 2560×1600，
否则 `fit` 无法把 `derived` 反算回 `offset`，`check` 也无法做基准反解。

**数据来源**（布局文件 `sources` 字段与本节一致）：`measured1600`（截图量出的元素**几何中心**）>
`local`（本机点击落点，可能刻意点偏）> `reference`（出厂 `hi-coords.json`）。布局文件里的
`derived.source` 记录每项实际来自哪个来源，`check` 会统计 `source: local=N reference=M measured1600=K`
——**看到 `reference` 的项就知道它没在本机验证过**。

> 与 `calibration.md` 的"本机值优先"不冲突：那里讲的是**点击**名义（`local` > 出厂），
> 这里讲的是**搜索窗中心**——本轮 5 项因为要和 1080p 同一定义比对，换成了几何中心；
> 其余项仍是 `local` 的点击落点（点偏几个像素不影响 128px 的搜索窗）。

## 3. 模型定义

每个条目：

```json
{
  "id": "tasks.onekey_claim",
  "anchor": "tr",
  "scaleMode": "width",
  "offset": { "dx": -157.5, "dy": 178.5 },
  "derived": { "x": 2350, "y": 238, "source": "measured1600" },
  "confidence": "high",
  "desc": "作战任务页右上「一键领取」",
  "note": "锚点 tr：任务页右上按钮贴右上角；【1080p 校准】实测中心 1600p (2350,238) / 1080p (1762,180)…"
}
```

### 3.1 解析公式

```
k      = scaleMode == "width"  ? W / reference.w
       : scaleMode == "height" ? H / reference.h
       : 1                                    // fixed：不缩放，1 逻辑像素 = 1 屏幕像素

anchorX/AnchorY 见下表（W/H = 当前客户区宽高）

x_raw  = anchorX + dx × k
y_raw  = anchorY + dy × k
x      = clamp(round(x_raw), 0, W - 1)        // 越界时 clamped = true
y      = clamp(round(y_raw), 0, H - 1)
```

| anchor | 锚点位置 | 典型用途 |
| --- | --- | --- |
| `tl` | (0, 0) | 左上角常驻按钮（返回、主菜单、任务图标） |
| `tc` | (W/2, 0) | 顶端居中条 / 列表内元素（贴顶） |
| `tr` | (W, 0) | 右上角按钮列（一键领取、一键申请） |
| `ml` | (0, H/2) | 左侧竖排工具栏的纵向中点 |
| `mc` | (W/2, H/2) | 全屏中央 / 居中弹窗（确定、取消） |
| `mr` | (W, H/2) | 右侧边缘纵向中点 |
| `bl` | (0, H) | 左下角（申请新委托） |
| `bc` | (W/2, H) | 底部居中（底部进度条、居中面板底部按钮） |
| `br` | (W, H) | 右下角按钮组（一键远征 / 一键打工 / 一键减负 / 底部 dock） |

**`offset` 的符号**：`tr / mr / br` 的 `dx` 必须 **≤ 0**，`br / bc / bl` 的 `dy ≤ 0`。
`check` 不强制符号，但 `fit` 反算出来的天然是负的；写成正数说明 anchor 选错了边。

### 3.2 scaleMode 怎么选（★ 已实测，默认 `width`）

| 值 | k | 什么时候用 | 本仓库 |
| --- | --- | --- | --- |
| `width` | `W / 1920` | **默认**。面板 / 列表 / 贴边 UI：实测按宽度缩放（§11），16:10→16:9 是 ×0.75 | **26/34** |
| `height` | `H / 1080` | **弹窗类**（确定/取消、确认框）。实测它们既不跟宽比也不跟高比，只能挑一个当搜索窗；`height` 比 `width` 更接近（786 vs 814，实测 797） | 8/34 |
| `fixed` | `1` | 不随窗口缩放的东西（原生窗口控件、DPI 固定的 HUD） | 0 |

弹窗 8 项：`game.click_anywhere`、`dialog.ok`、`popup.ok2`、`comm.put_pool`、`material.reduce_confirm`、
`exp.dispatch`、`work.confirm`、`comm.submit_confirm`。

**为什么不能全用 `width`**：弹窗是独立于页面布局的另一套坐标系（居中 + 自身尺寸），
实测 797 落在宽比（814）与高比（786）之间，两个模型都不对。选 `height` 只是让搜索窗少偏 6px，
真正的解法是弹窗模板必须精确命中（§6 第 3 条 / §9）。

### 3.3 基准反算（offset 从哪来）

`offset` 不手写，由 `fit` 从 `derived` 反算：

```
kBase      = scaleMode == "width"  ? base.w / reference.w      // hi：2560 / 1920 = 1.3333
           : scaleMode == "height" ? base.h / reference.h      // 1.4815（仅弹窗用）
           : 1

anchorBase = 用 base.w/base.h 与 item.anchor 算出的锚点坐标（例：tr → (2560, 0)）
dx         = (derived.x - anchorBase.x) / kBase
dy         = (derived.y - anchorBase.y) / kBase
```

因为 `kBase` 与 `anchorBase` 都按 anchor/scaleMode 走，**任意 scaleMode 在 base 分辨率下都能精确复原**
（`check` 的 `roundtrip.maxDev` 就是验这个）。hi 这份 34 项的实测最大偏差是 **0.0000px**。

### 3.4 关键结论：哪个轴是行为开关，取决于 scaleMode

把 anchor 代入公式，两边都展开成「base 坐标 × k / kBase + 修正项」：

```
x = anchorX + dx × k ，  anchorX ∈ {0, W/2, W}
y = anchorY + dy × k ，  anchorY ∈ {0, H/2, H}
```

**`scaleMode: height`（k = H/1080，只有弹窗用）**：`H` 与 `k` 同步 ⇒ `anchorY` 的贡献被完全抵消

```
y = k × derived.y / kBase      // tl/tc/tr 相同，ml/mc/mr 相同，bl/bc/br 相同
```

⇒ 纵向标签**纯可读性**，横向才是开关（`W` 不随 `k` 变，三档锚定给出三组不同 x）。

**`scaleMode: width`（k = W/1920，本仓库主力）**：反过来——`W` 与 `k` 同步 ⇒ `anchorX` 被抵消

```
x = k × derived.x / kBase      // tl=tc=tr 数值完全相同，ml=mc=mr、bl=bc=br 同理
```

⇒ **横向标签纯可读性，纵向才是开关**。实测验证（同一份 34 项，只改 anchor 重新 fit）：

| 条目 | anchor 改成 | 1920×1080 | 3440×1440 |
| --- | --- | --- | --- |
| `side.pool_tab` | `tl` / `tc` / `tr` | 1848, 312（三个值相同） | 3311, 559（三个值相同） |

而纵向选错边是**实打实的偏移**，且随宽高比放大：

```
顶锚 y = k × derived.y / kBase
底锚 y = H + (derived.y − base.h) × k / kBase = 顶锚 y + (H − base.h × k / kBase)
顶锚 − 底锚 = base.h × k / kBase − H = 1600 × W / 2560 − H
```

| 分辨率 | 顶锚 − 底锚 | 说明 |
| --- | --- | --- |
| 1920×1080 | 1600×1920/2560 − 1080 = 1200 − 1080 = **+120** | 贴底元素用顶锚会比正确位置低 120px（掉出屏幕，被 clamp） |
| 3440×1440 | 2150 − 1440 = **+710** | 21:9 上差 710px，直接废掉 |

实测佐证：`exp.onekey`（一键远征，贴右下）用 `tr` 得 y=1079（被 clamp），用 `br` 得 y=999；
1080p 实测底部条带（历练值条 999 ✓、家园底栏入口 995–1000 ✓、主界面 dock 组 1010）。所以**贴底/贴边的元素，纵向必须选边**，
这条比横向"选左中右"重要得多——`width` 模式下横向锚点对数值没有影响（但主界面 dock 组的横向位置本身
不服从宽比律，见 §11 例外，那部分只能靠模板；该组两个实测点不在 coord 表内）。

## 4. anchor 选择启发式

先按"这条按钮贴着哪条边"判，再按"它离哪条边近"兜底。**在 `width` 模式下只有纵向部分影响数值**，
横向仍要写对（可读性 + 万一将来换 `scaleMode`）：

| 判据 | anchor | 理由 |
| --- | --- | --- |
| 顶部元素（`y < 0.30H`），贴右 | `tr` | 右上按钮列（一键领取 / 一键申请 / 右侧页签） |
| 顶部元素，贴左 | `tl` | 左上常驻按钮（返回 / 主菜单 / 任务图标） |
| 列表/面板内部元素（不是贴边） | `tc` | 顶锚 + 中线读法；`width` 模式下与 `tl/tr` 同值 |
| 贴底元素（`y > 0.88H`），偏右 | `br` | 右下按钮组 / 底部 dock（一键远征 / 打工 / 减负 / 历练值） |
| 贴底元素，居中 | `bc` | 底部横条 / 居中面板的底部按钮 |
| 贴底元素，偏左 | `bl` | 左下角落按钮（申请新委托） |
| 中央弹窗的确定/取消（`x ≈ W/2`） | `mc` | 弹窗居中绘制，跟中线走 |
| 左侧竖排工具栏（`x < 0.05W`），纵向居中 | `ml` | 启动器图标列 |
| 3D 场景内的投影物体 | `tl` + `confidence:"low"` | 见 §9 |

hi 这份的实际分布（34 项）：`tl=5 tc=2 tr=5 ml=1 mc=5 mr=0 bl=1 bc=5 br=10`。
逐项理由写在 `hi-layout.json` 每项的 `note` 里。

> 历史注：旧版曾论证「居中面板内部应该用 `tc`」——那是在 `height` 模式下的正确结论（`W` 不随 `k` 变，
> 面板左缘 `(W−panelW×k)/2` 必须由中线吸收）。换成 `width` 模式后三种横向锚定等价，这个论证不再需要，
> 但结论不冲突（都落在同一 x 上）。

## 5. CLI

```powershell
# 单项（人类可读）
node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen 1920x1080 --item tasks.open

# 单项（机器可读）
node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen 1920x1080 --item tasks.open --json

# 全部（--all 与 --json 组合是给脚本用的）
node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen 1920x1080 --all --json

# 校验：schema 形状 + offset 与 derived 是否一致 + 在 base 上能否反解回 derived
node ..\game-daily\scripts\layout.mjs check --layout "references\hi-layout.json" [--json]

# 导出：把某分辨率下全部落点写成 JSON（离线排查 / 画图）
node ..\game-daily\scripts\layout.mjs export --layout "references\hi-layout.json" --screen 1920x1080 --out "%TEMP%\layout-1080p.json"

# 维护：从 derived 反算 offset（默认 dry-run，--write 才落盘）
node ..\game-daily\scripts\layout.mjs fit --layout "references\hi-layout.json" [--write]
```

单项输出（`--json`）：

```json
{ "id": "tasks.open", "x": 113, "y": 194,
  "screen": { "w": 1920, "h": 1080 }, "scale": 1,
  "anchor": "tl", "offset": { "dx": 112.5, "dy": 193.5 },
  "scaleMode": "width", "clamped": false,
  "desc": "主界面左上「任务」图标", "note": "…" }
```

`--all --json` 外层是 `{ ok, screen, count, clamped: [id…], items: [...] }`。
`check` 外层是 `{ ok, layout, stats:{ items, byAnchor, byScaleMode, bySource, roundtrip } }` + `errors` / `warnings`。
人类可读的表头会打印 `k(width)=1 k(height)=1 scaleMode=height:8 width:26`，先看这行确认模型没走偏。

**退出码**：`0` 成功 / `1` `check` 不通过 / `2` 用法或文件错误（`--json` 时 stdout 仍给
`{"ok":false,"error":"…"}`，stderr 同时有一句中文）。脚本里判 `0/1/2`，不要只看 stdout。

## 6. 怎么把结果接给 `locate --region`

```powershell
# 1) 拿中心
node ..\game-daily\scripts\layout.mjs resolve --layout "references\hi-layout.json" --screen "${W}x${H}" --item tasks.onekey_claim --json
# 2) 以 (x,y) 为中心开窗（w=h=128 足够；模板本身通常 ≤80px）
node ..\game-daily\scripts\locate.mjs --window "崩坏3" --template "references\templates\tasks.onekey_claim.png" `
  --region "$($x-64),$($y-64),128,128" --threshold 0.72 --json
```

四条纪律：

1. `clamped: true` 说明落点已经贴边，**区域要给够余量**（向外扩到边界外会被裁，向内给 160~200），
   否则窗口一半在屏幕外、模板被切掉。
2. 区域宁大勿小。大一点只是慢；切掉目标是**直接定位失败**。
3. **弹窗（8 项 `height` 模式、`confidence:"low"`）不要信先验定窗**：实测偏 11~17px，
   叠加窗口取整就可能切边——直接全客户区搜，或按弹窗标题模板定窗。
4. **拿不准就不带 `--region`**，全客户区搜（`SKILL.md` §2.2 工具契约最后一行）。

## 7. 自测记录（真实跑过，2026-10-30 按 width 模型重跑）

```
# ① base 反解：2560×1600 下 34 项应逐项回到 derived
node scripts\layout.mjs resolve --layout ..\game-daily-hi\references\hi-layout.json --screen 2560x1600 --all --json
  → items=34  clamped=none
  → 逐项与 derived 对比：raw max deviation = 0.000e+0 px（round 后 0.0000 px），>1e-9 的项 0 个
  → 即 34/34 精确复原（所以"最大偏差 id"为 null——没有一项有偏差，而不是漏报）

# ② 16:9：1920×1080（width 模式 k=1.0，即 offset 直接就是像素）
node scripts\layout.mjs resolve --layout ..\game-daily-hi\references\hi-layout.json --screen 1920x1080 --all
  → items=34  clamped=none
  → 左贴边：tasks.open 113,194 · nav.back 92,46 · nav.main_menu 350,54
  → 右上：tasks.onekey_claim 1763,179（91.8%W/16.6%H）· side.pool_tab 1848,312 · exp.claim_one 1443,364
  → 右下：nav.home 1694,1019（88.2%/94.4%）· exp.onekey 1783,999 · work.claim_rewards 1756,999
  → 家园底栏入口（右→左）：nav.work 1479,989 · nav.expedition 1223,989
    （两项均 `medium`；locate 实测 1080p 1470,995 / 1225,995，残差 −9,+6 / +2,+6）
    ⚠️ nav.home 1694,1019 仍无直接实测（`low`）。主界面 dock 组另有两个实测点（舰团 1300,1010 / 家园 1605,1010），
       它们**不在 coord 表内**，别把它们的残差套到任何 `nav.*` 上（§11 例外段）
  → 弹窗（height 模式）：dialog.ok 960,786 · popup.ok2 960,771 · material.reduce_confirm 960,767 · monthcard.claim 960,929
  → 与 1080p 实测对比（§11）：nav.main_menu −1,−1 · tasks.onekey_claim −1,+1 · dialog.ok −1,+11

# ③ 跨分辨率
1920×1080  k(width)=1       items=34 clamped=none
1280×720   k(width)=0.6667  items=34 clamped=none
3840×2160  k(width)=2       items=34 clamped=none
1024×768   k(width)=0.5333  items=34 clamped=none
3440×1440  k(width)=1.7917  items=34 clamped=launcher.start_game, tasks.clan_go, tasks.material_go
  → 21:9 是**模型适用边界之外**（见下）：W/H=2.39 时 width 律要求 UI 高 1600×(3440/2560)=2150px，
    而屏幕只有 1440px，中下部元素必然越界。上表 3 项就是被 clamp 的，**在 21:9 上不要用它们的先验**。
  → 适用区间：**W/H ≤ 16:9（1.78）**。16:9 时溢出正好 120px，由"贴底元素改底锚"吸收（§3.4），
    所以 16:9 / 16:10 / 4:3 全部 clamped=none。更宽的 21:9 需要单独标定（或改用 height 模式）。

# ④ 结构校验
node scripts\layout.mjs check --layout ..\game-daily-hi\references\hi-layout.json
  → game=hi items=34 reference=1920x1080 base=2560x1600
    anchors tl=5 tc=2 tr=5 ml=1 mc=5 mr=0 bl=1 bc=5 br=10
    scaleMode height=8 width=26 fixed=0
    source reference=6 local=23 measured1600=5
    roundtrip 34 项最大偏差 0.0000px（id: -）  clamped@base=0  clamped@reference=0
    CHECK PASS
# 反例（证明 check 真会拦）：把 tasks.open 的 offset.dy 手工 +5（193.5 → 198.5）
  → roundtrip 34 项基准反解，最大偏差 6.6670px（id: tasks.open）   clamped@base=0  clamped@reference=0
    x items[tasks.open]: offset 与 derived 不一致（按 derived 反算偏移 6.667px），跑 fit 修正
    x items[tasks.open]: 基准反解偏差 6.667px > 0.5px
    CHECK FAIL（exit 1）
  → 注意 6.667 = 5 / 0.75：base 下 k=1.3333，1080p 偏 5px 等于 base 偏 6.67px
```

## 8. 维护流程（改坐标时按此顺序）

1. **改哪**：改 `hi-layout.json` 的 `derived.{x,y,source}`（或上游 `coords.local.json` 后同步 `derived`），
   **不要手写 `offset`**。`source` 用词：`local`（本机点击校准）/ `reference`（出厂）/
   `measured1600`（截图量出的元素中心，不是点击落点）。
2. `node scripts\layout.mjs fit --layout "references\hi-layout.json" --write` —— 从 `derived` 重算全部 `offset`。
3. `node scripts\layout.mjs check --layout "references\hi-layout.json"` —— 必须 `CHECK PASS`。
4. `node scripts\layout.mjs resolve ... --screen 2560x1600 --all --json` —— 确认 34 项逐项回到 `derived`。
5. 再挑 1920×1080 / 1280×720 / 3840×2160 各跑一次 `--all`，确认 `clamped` 为空（21:9 会 clamp，见 §7-③）。
6. 顺手把新实测写进 `calibration.measured[]`（同一次校准的证据留档），并更新对应项的 `confidence`。

四条红线：

- **本机值只进 `state/coords.local.json`**，绝不写回 `references/`（`calibration.md` 三纪律第 1 条）。
- **不要手改 `offset`**：`check` 拿 `derived` 反算对照，差 >0.01px 就 FAIL——这是故意的。
- **换 base 分辨率**（例如换到 4K 屏重新标）：`base` 与全部 `derived` 一起换，再跑 `fit`；只换 `base`
  不换 `derived`，`check` 会立刻报全体不一致。
- **`confidence` 不许随手写 high**：只有"两档分辨率实测吻合（残差 ≤2px）"才配 `high`；
  没实点 / 结构会变（列表换列、弹窗）一律 `low`。

## 9. 已知不确定项（按可疑程度排序）

`hi-layout.json` 里每项的 `note` 都写了锚点理由与可疑点；`confidence` 分布：`high=3 medium=15 low=16`。
这里汇总最需要实机复核的几条（1080p 期望值 = 新模型输出）：

| id | conf | 1080p 期望 | 为什么可能不准 | 怎么验 / 怎么修 |
| --- | --- | --- | --- | --- |
| `dorm.capsule_stamina` | low | 480, 404 | 3D 家园场景里的**投影**位置，随相机 FOV/宽高比变化，不遵守 2D 宽比律；语义也待核（点它弹的是**体力补充**，不是金币采集） | 进家园量胶囊实际位置，直接改 `derived`（`width` 模式下横向锚点是哪个不影响数值） |
| `tasks.clan_go` | low | 985, 818 | **从未实点**；列位置由**当日列表内容**决定（1080p 实测那天在右列 1763,819，左列先验差 +778） | 用「舰团委托」行标题模板定位，再 +行内偏移（§12） |
| `tasks.coin_go` / `tasks.material_go` | low | 985,599 / 1765,818 | 同上：坐标本身按律是对的，但**当天在哪一列不知道**（实测那天金币采集在右列、材料活动在左列那一行不存在） | 同上，一律走 §12 的行标题 → 行内按钮 |
| `nav.expedition` / `nav.work` | medium | 1223,989 / 1479,989 | **语义已确认**：是**进「家园」后**底栏的「远征 / 打工」入口，**不是**主界面 dock；locate 实测 1080p **1225,995 / 1470,995**（score 1.0000，uniqueness 0.4517 / 0.4927）→ 残差 **+2,+6 / −9,+6**，与面板类同一量级 → `medium` | 实测点已写进 `note`；模板 `templates\nav.expedition.png` / `nav.work.png` 已裁，用 locate 复核 |
| `nav.home` | low | 1694,1019 | **从未直接量过**；主界面 dock 组（舰团 1300,1010 / 家园 1605,1010）实测不服宽比律，但那两个点**不在 coord 表内**，与本项无关 | 实机量本项本身；先验只当搜索窗（§11 例外段） |
| `dialog.ok` / `popup.ok2` / 其余弹窗 | low | 960,786 / 960,771 | **弹窗不遵守任何单一比例律**（实测 797，宽比给 814、高比给 786，各偏 17/11px） | 只能靠模板定位；别用先验定窗（§6 第 3 条） |
| `launcher.hi_icon` | low | 277, 712 | 启动器是**自绘窗口**，缩放模型未知；图标列还会随已安装游戏数上下移位 | 启动器窗口化/全屏各看一眼；只作粗定位 |
| `launcher.start_game` | low | 1413, 875 | 同上；21:9 上会被 clamp（§7-③） | 同上 |
| `signin.claim` / `monthcard.claim` | low | 1108,1011 / 960,929 | **仅出厂值，未在本机校准**（`source=reference`）；面板位置随版本变 | 下次进到这页实测，写 `coords.local.json` 后重跑 `fit` |

> 判据：`check` 打印的 `source reference=N` 是"没在本机验证过"的项数（当前 6 项：
> `launcher.hi_icon`、`launcher.start_game`、`popup.ok2`、`dorm.capsule_stamina`、`signin.claim`、
> `monthcard.claim`）、`scaleMode width:26 height:8` 说明弹窗那 8 项永远只能当搜索窗。

## 10. 数据口径（容易误会的地方）

- **条数**：`hi-layout.json` 是 **34 项**，不是任务书里写的 29 项——`hi-coords.json` 本身就 34 条，
  布局文件按"不漏项"原则 1:1 覆盖（漏一项就意味着那次点击没有先验）。`check` 会打印 `items=34`。
- **`derived` 是元素中心，不是点击落点**：`local` 来源是当时实际点下去的像素（可能刻意点在按钮中心偏一点），
  `measured1600` 是从截图上量出来的元素几何中心。两者能差几十像素（`nav.main_menu` 481,95 → 466,72），
  对"搜索窗中心"来说几何中心更合适，所以这 5 项换成了 `measured1600`。
- **`tasks.clan_go` 的冲突取舍**：出厂 `2337,1073`（note 自己写着"未实测、实际在左侧列"）与本机
  `1352,1088`（按参考图推算、未实点）矛盾。按"本机校准优先"取 **1352,1088**，
  `derived.source = local`；1080p 实机又证明那天它在右列 → `confidence: low` + §12 的相对定位法。
  出厂值弃用而不是静默删除。
- **`offset` 精度**：落盘保留 6 位小数，`resolve` 输出取整（`Math.round`）。取整最多引入 0.5px 误差，
  对"搜索窗中心"完全够用；需要亚像素时用 `resolveItem` 的 `withRaw` 选项。

## 11. 经验尺度律（2026-10-30 1080p 实机实测）

**量法**：同一界面元素在 1600p（`references/screens/tasks.png`，1000×625 ×2.56 → 2560×1600）与
1080p（实机客户区截图 1920×1080）各量一次中心与尺寸。全部是客户区像素，不含窗口边框。

| 元素 | 1600p 中心 | 尺寸 1600p→1080p | 1080p 实测 | 宽比 0.75 预测 | 残差 | 高比 0.675 预测 | 残差 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 主菜单按钮 | 466,72 | 346×100 → 259×76 | 349,53 | 350,54 | −1,−1 | 315,49 | **+34,+4** |
| 一键领取 | 2350,238 | 323×87 → 242×65 | 1762,180 | 1763,179 | −1,+1 | 1778,161 | **−16,+19** |
| 每日登录·领取 | 1311,509 | 276×105 → 208×79 | 984,381 | 983,382 | +1,−1 | （按 `tc` 锚 981,344） | +3,**+37** |
| 芽衣的加餐·领取 | 2350,509 | 同上 | 1763,381 | 1763,382 | 0,−1 | — | — |
| 金币采集·前往 | 1313,799 | 同上 | 1763,600 | 985,599（左列先验） | x 换列, +1 | 982,539 | x 换列, **+61** |
| 舰团委托·前往 | 1313,1091 | 同上 | 1763,819 | 985,818（左列先验） | x 换列, +1 | 982,736 | x 换列, **+83** |
| 每日历练值条 | —,1492（距底 108） | — | —,999（距底 81） | 底锚 999（距底 81） | 0 | 1007（顶/底同值） | −8 |

**三条结论**：

1. **面板/列表/贴边 UI 按宽度缩放**：`k = W/2560`（1600p 基准）→ 1080p 是 **0.75 = 1920/2560**，
   不是高度比 **0.675 = 1080/1600**。尺寸也同步：259/346 = 0.749、242/323 = 0.749。
   宽比律在 5/5 可比元素上残差 **≤1.5px**；高比律 16~83px。→ 主体 `scaleMode: "width"`。
   （家园底栏两项也吻合：`nav.expedition` +2,+6、`nav.work` −9,+6，见 §9；主界面 dock 组是另一件事，见下方例外。）
2. **贴底元素按底边锚定**：历练值条距底 108 → 81（×0.75）。同一元素用顶锚会低 120px
   （1119 > 1080，直接掉出屏幕下缘）。→ 贴底元素纵向一律 `br`/`bc`/`bl`（横向见下面的 dock 组例外）。
3. **弹窗不遵守任何单一比例律**：`dialog.ok` 实测 (959,797)，宽比给 814（偏 17）、高比给 786（偏 11），
   居中+宽比 814 也不对。→ 弹窗保留 `height`（少偏 6px）但 `confidence: low`，**必须靠模板定位**，
   别用先验定窗。

**例外：主界面底部 dock 组（舰团 / 家园，不在 coord 表内）不服从宽比律**（2026-10-30 实机实测，1080p 客户区）：

| 元素 | 1080p 实测中心 | 若误当成 `nav.expedition`/`nav.work` 先验 | 残差（宽比） | 残差（高比） |
| --- | --- | --- | --- | --- |
| 舰团 | **1300,1010** | 1223,989 | **+77,+21** | 1196,998 → +104,+12 |
| 家园 | **1605,1010** | 1479,989 | **+126,+21** | 1427,998 → +178,+12 |

→ **这两个坐标不是 `nav.*` 任何一项**（`nav.expedition`/`nav.work` 是进「家园」后的底栏入口，实测 1225,995 / 1470,995，残差只有 +2,+6 / −9,+6，见 §9）。主界面 dock 组疑似"**居中分组 + 固定间距**"（两点间距 305），
`hi-coords` / `hi-layout` 里没有它们的 id，**别把 dock 的残差套到 `nav.expedition`/`nav.work` 上**，
它们只能靠模板/锚点定位。`nav.home` 也仍未直接量过，仍是 `low`。

**适用边界**：实测覆盖 16:10 → 16:9（以及更窄的 4:3/16:10）。比 base 更宽的 21:9 属于另一套行为
（width 律会让 UI 高度溢出屏幕），3440×1440 上有 3 项越界（§7-③），用前先单独标定。
另：**宽比律只对面板/列表/贴边 UI 成立**，主界面 dock 组（上表，不在 coord 表内）与弹窗不适用。

## 12. 用 anchor+offset 做相对定位（抗缩放、抗换分辨率）

布局文件给的是**绝对位置**；真正稳的用法是把它当**相对几何表**用：
**先 `locate` 一个稳定锚点（标题、图标、行文字），再按 `offset × 实际 scale` 推目标**。
这样 UI 缩放、分辨率变化、甚至列表换行都不需要重新标定。

```
目标 = 锚点命中中心 + (offset_目标 − offset_锚点) × s
       s = locate 报的尺度比（截图里模板实际尺寸 / 模板文件尺寸）
       offset_* 用本文件的 reference 值（1080p 下 1 单位 = 1 像素，s=1 时可直接加）
```

为什么成立：`offset` 已经吸掉了锚点与 base 的关系（§3.3），所以两个 offset 之差就是**纯相对位移**，
与锚点选哪条边、屏幕多宽**无关**；`s` 只需处理"UI 相对 1080p 又缩放了"这一层。

**已验证的行网格不变式**（`tasks.*` 任务列表，来自 1080p 实测 + 1600p 参考图交叉核对）：

| 量 | 1080p（reference 单位） | 1600p（base） | 说明 |
| --- | --- | --- | --- |
| 行距 Δy | **219** | 292（=219×1.3333） | 每行等距，实测 381 / 600 / 819 |
| 左列按钮 x | **984** | 1313 | 左列「前往/领取」 |
| 右列按钮 x | **1763** | 2353 | 右列「前往/领取」 |
| 同列左右差 Δx | **779**（±1 取整） | 1040 | 1040×0.75 = 780 |

于是当日哪怕列表换列、换行，也能算：

```
金币采集 = 金币采集行标题中心 + (402, 98)          // 实测常量，见下
舰团委托 = 金币采集按钮 + (0, 219) × s            // 同一列，下一行
材料活动 = 金币采集按钮 + (0, 219×2) × s
```

实测验证：1080p 那天 金币采集 (1763,600) → 舰团委托 (1763,819)，Δy = 219 ✓ 与列无关。

**行标题中心 → 同行「前往」按钮中心 = `(+402, +98)`**（2026-10-30 Lead 在 1080p 实机量的，
**四个 id 完全一致**，写死可用）：

| id | 行标题中心 | 同行按钮中心 | 差值 |
| --- | --- | --- | --- |
| `tasks.coin_go` | 金币采集 582,283 | 984,381 | +402,+98 |
| `tasks.clan_go` | 舰团委托 581,502 | 984,600 | +402,+98 |
| `tasks.material_go` | 材料活动 1361,502 | 1763,600 | +402,+98 |
| `tasks.dorm_work_go`（该 id 只在 run-step 侧，未进 hi-layout） | 家园打工 1361,283 | 1763,381 | +402,+98 |
| （剧情关卡，无模板/无 id，未启用） | 剧情关卡 582,721 | 984,819 | +402,+98 |

量法：行标题用**近白掩码（RGB > 190）**取 bbox 中心，按钮取**黄色 blob** 中心，两者都是客户区像素。
用的时候一律 `按钮 = 锚点中心 + (402, 98) × s`（`s` = `locate` 报的 `scale`，1080p 下 `s = 1`）。

**已落盘的可执行资产**（不用自己再量）：
`references\templates\anchors.json` —— 上表前四项的 `{ "anchor": "<文件名>.anchor.png", "dx": 402, "dy": 98, "note": … }`；
四个 **160×44** 锚点模板 `tasks.coin_go.anchor.png` / `tasks.clan_go.anchor.png` /
`tasks.material_go.anchor.png` / `tasks.dorm_work_go.anchor.png`，与目标模板同放在 `references\templates\`（无子目录）。
`run-step.mjs` 的 `locateTarget` 已实现"目标模板未命中 → 退到锚点模板 + offset"的回退链。

> ⚠️ **锚点必须全屏搜索**：锚点离目标 402px（约 1/5 屏宽），若拿目标的先验窗（`layout` 给的
> `--region`）去搜锚点，必然把锚点切在窗外。行序随当日内容漂移时，锚点法是**唯一可靠路径**——
> 实测例子：今日「金币采集」排在第一行，先验 985,818 完全错位，锚点法直接命中 984,381，score = 1.0。

**具体接法**（`locate.mjs --json` 里有命中中心 `cx/cy`、`score`、`scale`）：

1. 全屏 `locate` 锚点模板 → `(cx, cy)`、`s`；
2. `按钮 = (cx + 402 × s, cy + 98 × s)`；`score < 0.72` → 未找到，停手（R3），不要退化成按坐标点；
3. 必须**同屏**：跨页（点完「前往」进了另一个界面）之后锚点失效，要重新认屏再走一遍。

**为什么值得这么做**：`tasks.coin_go` / `tasks.clan_go` / `tasks.material_go` 的位置由
"今天这一行排在第几个/哪一列"决定，与分辨率无关——布局文件再准也追不上（§9 `confidence: low` 的根因）。
相对定位把"行内几何"和"行在哪"拆开：前者是稳定的（上表），后者交给视觉定位。
