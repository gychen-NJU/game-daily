# 崩坏3 认屏速查（hi-screens）

**认屏靠"文案 + 版式"，不是靠像素位置。** 每个界面有两个独立证据：

1. **R2 闸门**：本页"必须看到的文案"**全部**出现，才承认"我在这个界面"；
2. **R3 定位**：要点的那个控件，用对应的**模板**在客户区里找到（`score ≥ 0.72`）才点。

两者缺一不可：文案对、但控件没定位到 → 不点；控件定位到、但文案不对 → 说明在别的界面，不点。
配合 `references/screens/` 的参考图看。模板路径统一为 `references/templates/<id>.png`。

```powershell
node ..\game-daily\scripts\locate.mjs --window "<游戏窗口标题>" `
     --template "references\templates\<id>.png" --threshold 0.72 --json
```

`found=false` / `score < 0.72`（exit 2）= **不许点**；先按 R7 停手判断，不要退回坐标表点击。

## 界面与判据

| 界面 | 必须看到的文案（R2 闸门） | 参考图 | 点击目标模板（R3） | 锚点模板 / 点击偏移（R9） | 备注 |
| --- | --- | --- | --- | --- | --- |
| 启动器（别的游戏页） | 页面标题不是「时序照新」 | — | — | — | 左侧竖排图标，崩坏3 是**白色/银色角色 + 左上「10 周年」角标**；位置不固定，按外观找 |
| 启动器（崩坏3 页） | 「崩坏3」「时序照新 V9.1」「开始游戏」 | `launcher-hi-icon.png` | `launcher.hi_icon`、`launcher.start_game` | — | 右下黄按钮才是开始游戏；图标位置随已装游戏数变化 |
| LOADING | 顶部 `LOADING` + 「检查资源更新…」 | — | — | — | 20–40 s，别乱点 |
| 标题界面 | 顶部橙色 `IDENTIFYING` + 「点击任意处进入游戏」+ 底部账号/服务器 | — | `game.click_anywhere`（点客户区任意处，可免模板） | — | 点屏幕任意处即进 |
| 每日签到 | 「每日签到」28 天格子 + 底部「领取」 | — | `signin.claim` | — | 进游戏自动弹 |
| 主界面 | 左侧：任务/活动/福利/邮件/公告/商城；底部：舰团/家园 | — | `tasks.open`、`nav.main_menu`、`nav.home` | — | 顶部有 等级、历练值、体力、金币、水晶；**底部 dock 的「舰团/家园」不是 `nav.expedition`/`nav.work`**（这两项在家园底栏） |
| 作战任务 | 「作战任务」「历练任务」「一键领取」「每日历练值」 | `tasks.png` | `tasks.onekey_claim`、`tasks.daily600` | **`tasks.coin_go` / `tasks.clan_go` / `tasks.material_go` / `tasks.dorm_work_go`**：先 locate 行标题锚点（「金币采集」/「舰团委托」/「材料活动」/「家园打工」），再点 `锚点中心 + (+402,+98) × scale`（`anchors.json` **已实测**） | 底部有 100/200/300/450/600 进度条；行顺序随当日任务内容变化 |
| 家园房间 | 「家园福利」「家园商店」「打工」「宿舍」「神之键」 | `dorm.png` | **家园底栏**「远征」=`nav.expedition`（已验证：score 1.0、center (1225,995)、uniqueness 0.45 → 可直点）；「打工」=`nav.work`（已验证：score 1.0、center (1470,995)、uniqueness 0.49 → 可直点） | — | 这两个**不在主界面 dock**；两个管：蓝=体力补充；橙色管点下去也是体力补充（不是金币采集） |
| 远征 | 「今日远征可用体力」480/480、「一键远征」 | `expedition.png` | `exp.onekey`（已验证可直点）、`exp.dispatch`（缺模板） | **`exp.claim_one`**：同页 4~5 个**像素级同形**「完成远征」，全屏匹配 1.0 仍 **ambiguous**（runnerUp 0.9972 / uniqueness 0.0028）→ exit 2；**靠 `regions.json` 紧窗消歧**（条目已在：`pad [180,70]`）→ 紧窗 **score 0.9995 / uniqueness 0.6442 / ambiguous=false** → exit 0，**可执行**（点首行；任意一行功能等价）。**缺 `regions.json` 条目 → 退回 ±320 → ambiguous → 不可执行**。点之前确认列表在顶部（没滚动） | 6 条列表，每条右侧「完成远征」 |
| 打工地图 | 地图 + 顶部「饭团」+ 右下「一键打工」「领取奖励」 | `work.png` | `work.claim_rewards`、`work.onekey`、`work.confirm`、`nav.back` | — | **没有「主菜单」**，只能「返回」（连点两次） |
| 回收委托 | 「回收委托」「申请新委托」「提交」「今日剩余次数」 | `commission.png` | `comm.new`、`comm.onekey_apply`、`comm.submit_confirm`、`comm.put_pool` | **`comm.submit`**：锚点=当前委托行的标题/序号，**`comm.submit.anchor.png` 尚未裁剪、`anchors.json` 也无条目 → 现在不可执行**（先裁锚点 + 标定 offset） | 右下数字是剩余次数（8 次循环就看它） |
| 委托申请 | 「委托申请次数」1/10、「一键申请」、一排「接受」 | `commission.png` | `comm.onekey_apply` | — | 一键申请后变 10/10 |
| 舰团奖池 | 「常规发放」「随机发放」「舰团总贡献」「领取」 | `pool.png` | `side.pool_tab`、`pool.claim` | — | 右侧竖排第二个页签；上面那个是「回收委托」 |
| 材料活动 | 「材料活动」「一键减负」+ 四张卡 | `material.png` | `material.onekey_reduce`、`material.reduce_confirm` | — | 一键减负 → 日常减负 |
| 结算弹窗 | 「领取奖励」/「获取委托报酬」/「获得奖励」+「确定」 | `daily600.png` | `dialog.ok`（高弹窗）或 `popup.ok2`（矮弹窗） | — | **两种高度，必须用各自模板定位**，见下第 4 条 |

## 锚点模板 / 点击偏移（R9）

**适用**：同一屏出现多个**同形按钮**的 id。坐标先验只代表"某一天的某一行"——隔天任务列表内容变了、
换分辨率、列表滚动，都会错位，所以这类目标**不许用先验直接点，也不许拿单模板全屏匹配**。

**三种消歧手段（按顺序判断，2026-10-30）**：

1. **外观不同**（灰/亮、弹窗两种皮肤）→ `index.json` 外观变体；
2. **必须点"指定那一行/那一项"** → 锚点 + offset（本节主体，`anchors.json`）；
3. **同页同形、任意一行都行**（功能等价）→ `regions.json` 紧搜索窗
   （`{"<id>":{"pad":[半宽x,半宽y]}}`，单位 = 当前客户区像素；`run-step.mjs:layoutRegion()` 读，默认 ±320）。

**数据源**：`references/templates/anchors.json`（`{ "<id>": { "anchor": "<id>.anchor.png", "dx": 402, "dy": 98 } }`）。

**约定**：

- 锚点模板 = **行标题 / 卡片标题文字块**（越小越唯一越好），放 `references/templates/<id>.anchor.png`；
- `dx, dy` 单位是 **1080p 客户区像素**；点击 = `(cx, cy) + (dx, dy) × scale`，`cx,cy / scale` 取锚点那次 locate 的输出；
- **锚点必须全屏搜**：锚点文字离目标按钮约 402 px，若拿目标的先验去套 `--region`，锚点会被切出窗；
- 查表命中就点；**`anchors.json` 缺该 id = 这一步不可执行**：停手，或按 `../game-daily/SKILL.md` §2.4 用
  computer-use 手推。**禁止**拿坐标表里的 x,y 顶替（那正是 R4 要消灭的做法）。

**2026-10-30 实测**（1080p，作战任务页四行「前往」偏移一致 `(+402,+98)`）：

| id | 锚点（行标题中心） | 按钮中心 |
| --- | --- | --- |
| `tasks.coin_go` | (582,283) | (984,381) |
| `tasks.clan_go` | (581,502) | (984,600) |
| `tasks.material_go` | (1361,502) | (1763,600) |
| `tasks.dorm_work_go` | (1361,283) | (1763,381) |

单实例按钮（`tasks.open`、`pool.claim` …）不需要锚点：它的模板（含 `index.json` 里的外观变体）本身唯一匹配，直接用 `(cx,cy)`。

**反例：分数高 ≠ 唯一（2026-10-30）**：`exp.claim_one` 模板自匹配 **1.0**，但 `ambiguous=true`
（runnerUp **0.9972**、uniqueness **0.0028**）→ `locate` **exit 2 拒点**。同页 4~5 个按钮长得一样，
单模板天然分不清 —— 这不是调阈值能解决的。因为**任意一行远征都算完成**，解不是锚点而是**紧搜索窗**：
`regions.json` 的 `pad [180,70]`（先验 y±70 只含首行）→ **0.9995 / uniqueness 0.6442 / exit 0**。
若哪天该 id 缺 `regions.json` 条目 → 退回 ±320 → ambiguous → **不可执行**（别拿坐标顶替）。

## 容易看错的点

1. **「一键领取」灰掉** = 今天没有可领的，不是坏了。**不要**因为"点了没变化"去试别的坐标。
2. **「领取奖励」灰掉**（打工）= 还没到 14 小时，跳过；灰按钮不点。
3. **金色/水晶数字变化**是最可靠的"真的领到了"证据（领前后各截一张对比，落 `state/shots/`）。
4. **弹窗有两种高度**：`dialog.ok` 与 `popup.ok2` 差 23 px。**单模板不够**：实测 step2 里 `dialog.ok.png`
   在签到类弹窗只有 **0.579**（< 0.72，被拒 → fail-closed 停手）——因为「确定」按钮带不带 ✓ 图标是两种外观。
   现在 `index.json` 把 `popup.ok2.png` 也挂成 `dialog.ok` 的外观变体，逐个试取最高分（同一张图 **1.0**）。
   若所有变体都只到 0.6–0.7，按当前 expect 文案判断该弹哪个窗；判断不了 → 停手（R7），绝不"两个都点一下试试"。
5. **弹窗不遵守任何单一比例律**（2026-10-30 实测）：`dialog.ok` 1080p = (959,797)。x 符合宽度律（≈960），
   但 y 用宽度律外推 814、高度律外推 786，实测 797——两边都对不上。所以弹窗**只能模板定位**，
   不要用"按比例算一下"去猜。

## 认屏闸门怎么用（把上面这张表变成判定）

进入某步前：

- [ ] `locate` 抓到的**实时**截图里，本行"必须看到的文案"**全部**可辨认；
- [ ] 当前步 `expect` 与 `hi-daily.json` 一致（`expect.all` / `expect.any`）；
- [ ] 窗口仍是前台、没有被别的窗口遮挡（否则先置前再重抓，别用遮挡时的图）。
- [ ] 若目标是**同形按钮**（本表「锚点模板」列有内容）：先 locate 锚点模板（**全屏搜**，别套目标先验的 `--region`），
      拿到 `(cx,cy)` 与 `scale`，再按 `anchors.json` 的 `(dx,dy) × scale` 算按钮中心；`anchors.json` 没有该条目 → 停手，不点。

任何一条不过 → **不在这个界面**：要么先做导航动作（返回/主菜单），要么按该步 `onMismatch` 处理
（`stop` 优先，`retry1` 只重试一次）。

认屏只用来"确认页面"，**不用来推算点击位置**——位置永远来自活模板（R3）或 锚点+偏移（R9）。
