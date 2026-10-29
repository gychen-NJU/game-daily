# 模板资产（templates/）

定位引擎 `scripts/locate.mjs` 的唯一点击依据。**没有模板 → 按 R3 停手，不做坐标兜底。**

## 文件约定

| 文件 | 作用 |
| --- | --- |
| `<coord-id>.png` | 该 id 的**直点模板**（按钮本体的裁剪；只要按钮本体，别带周边背景） |
| `<coord-id>.anchor.png` | 该 id 的**锚点模板**（同屏唯一文案/图标，如行标题） |
| `index.json` | 同一 id 的**外观变体列表**：`{"dialog.ok":["dialog.ok.png","popup.ok2.png"]}`；逐个匹配取最高分 |
| `anchors.json` | 锚点+偏移：`{"tasks.coin_go":{"anchor":"tasks.coin_go.anchor.png","dx":402,"dy":98}}`；目标点 = 锚点命中中心 + (dx,dy)·scale |
| `regions.json` | 每 id 的搜索窗半宽覆盖：`{"exp.claim_one":{"pad":[180,70]}}`；用于**同页多行同形按钮**（远征页 4~5 行「完成远征」外观完全一致）——先验 y±70 只含一行，歧义自动消解 |

## 什么时候用哪种

- **按钮外观唯一**（如「一键领取」「主菜单」）→ 直点模板。
- **同屏多个同形按钮**（作战任务页多行「前往」「领取」、各类弹窗的「确定」）→ **锚点+偏移**（R9）；直点模板会命中错的按钮。
- **位置随内容漂移**（作战任务行序每天不同）→ 只能锚点+偏移，且锚点**必须全屏搜索**。

## 新增一个 id 的步骤（3 分钟）

```powershell
# 1) 进到目标界面，截一张干净的客户区图（游戏必须在前台）
powershell -File <win.ps1> -Action shot -ProcessId <pid> -Out shot.png

# 2) 先验只用于找候选，不能直接点
node scripts\layout.mjs resolve --layout references\hi-layout.json --screen 1920x1080 --item <id> --json

# 3) 从图中裁出按钮本体（UI 工具 ui.py crop / 任意截图工具），存进 templates\<id>.png
#    尺寸建议 200x80 上下；实测 442x98 的「确定」也能在 ~1.1s 内搜完

# 4) 验证：真图自匹配必须 ≥0.95；无该按钮的图必须 exit 2
node scripts\locate.mjs --image shot.png --template references\templates\<id>.png --json
node scripts\locate.mjs --image 反例.png --template references\templates\<id>.png --json

# 5) 落运行链：只定位不点击，跑该步自检
node scripts\run-step.mjs --game hi --step <n> --probe
```

## 实测基线（1920×1080，别低于这个）

| 场景 | score | 说明 |
| --- | --- | --- |
| 同图自匹配 | **0.96–1.0000** | 1.0 档是像素级精确命中 |
| 同形不同字（真的不是它） | 0.58–0.63 | 必须被拒 |
| 完全没这个按钮 | 0.37–0.51 | 必须被拒 |
| 已灰掉的按钮（已领取） | 0.96 | 能定位 ≠ 可点，仍看复检文案 |

阈值默认 **0.72**（`--threshold` 可改）；`best − runnerUp < 0.05` 判 ambiguous 并 exit 2。

## 已知缺口（会停在"模板缺失"，不会乱点）

- 崩坏3（`game-daily-hi`）：`hi-daily.json` 的 30 个 coord id **已全覆盖**（模板 / 变体 / 锚点三选一），冷启动三项 `launcher.hi_icon`、`launcher.start_game`、`game.click_anywhere` 也已裁好。
- 星穹铁道（`game-daily-sr`）：**暂无模板资产**，所有点击步骤按 R3 停手；需要先按上面的 5 步流程裁模板。
- 新增 id 的补法见本文开头「新增一个 id 的 5 步」。

## 覆盖率自检

```
node ..\..\game-daily\scripts\coverage.mjs %USERPROFILE%\.agents\skills\game-daily-hi
```
扫 `hi-daily.json` 全部 `coord` 字段，逐个验证模板/变体/锚点是否就位；缺一个 exit 2。
当前基线：**30 个 coord id，缺 0**（2026-10-30，1080p 演练后）。