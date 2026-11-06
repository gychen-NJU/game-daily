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

**基准尺寸**：本目录模板都是 **1920×1080 基准**；而 run 归档截图（`~/.dsh/game-daily/runs/<game>/<runId>/shots/`）是 **2560×1600** 桌面实图，
所以从 run 图裁出的模板要**缩到 0.75**，匹配时 `scale ≈ 1.331`（与既有资产口径一致）。

## 什么时候用哪种

- **按钮外观唯一**（如「一键领取」「主菜单」）→ 直点模板。
- **同屏多个同形按钮**（作战任务页多行「前往」「领取」、各类弹窗的「确定」）→ **锚点+偏移**（R9）；直点模板会命中错的按钮。
- **位置随内容漂移**（作战任务行序每天不同）→ 只能锚点+偏移，且锚点**必须全屏搜索**。
- **同一控件不同皮肤**（带 ✓ / 不带 ✓ 的「确定」）→ `index.json` 变体；**不同控件（圆角确定键 vs 整条黄色通栏）不算皮肤，必须各裁一张**。

## 新增一个 id 的步骤（3 分钟）

```powershell
# 0) 证据源二选一：① 历史 run 截图（不用重开游戏）② 现开游戏截一张干净客户区图
#    历史 run 图：%USERPROFILE%\.dsh\game-daily\runs\<game>\<runId>\shots\*.png（2560×1600）

# 1) 没现成图时才用：进到目标界面、游戏在前台，截一张干净的客户区图
powershell -File <win.ps1> -Action shot -ProcessId <pid> -Out shot.png

# 2) 先验只用于找候选，不能直接点
node scripts\layout.mjs resolve --layout references\hi-layout.json --screen 1920x1080 --item <id> --json

# 3) 从图中裁出按钮本体（别带周边背景），存进 templates\<id>.png
#    从 2560×1600 的 run 图裁的，再按 0.75 缩到 1920 基准；尺寸建议 200×80 上下，实测 504×99 也能在 ~1.1s 内搜完

# 4) 验证：真图自匹配 ≥0.95；同形异文案 / 无该控件的图必须 exit 2
node scripts\locate.mjs --image shot.png --template references\templates\<id>.png --json
node scripts\locate.mjs --image 反例.png --template references\templates\<id>.png --json

# 5) 挂进 index.json（专用模板排在通用别名之前）→ 覆盖率复核 → 落运行链只定位不点击
node ..\game-daily\scripts\coverage.mjs %USERPROFILE%\.agents\skills\game-daily-hi
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

- 崩坏3（`game-daily-hi`）：30 个 coord id **全部有可用资产**（`coverage.mjs` 缺 0）。但"覆盖"≠"专用外观"：
  `comm.put_pool`（放入舰团奖励池）**只有通用「确定」别名**、没有自己的通栏模板，到那一步大概率 0.5–0.7 → 停手。
- 2026-10-30 已补的四个「弹窗底部黄色通栏」模板（来源=10-30 10:00 轮截图，自匹配 0.979–0.986，反例 ≤0.67）：
  `exp.dispatch`（远征派遣）、`work.confirm`（一键打工）、`comm.submit_confirm`（提交委托）、`material.reduce_confirm`（减负）。
- 星穹铁道（`game-daily-sr`）：**暂无模板资产**，所有点击步骤按 R3 停手；需要先按上面的流程裁模板。
- 新增 id 的补法见本文开头「新增一个 id 的步骤」。

## 覆盖率自检

```
node ..\..\game-daily\scripts\coverage.mjs %USERPROFILE%\.agents\skills\game-daily-hi
```
扫 `hi-daily.json` 全部 `coord` 字段，逐个验证模板/变体/锚点是否就位；缺一个 exit 2。
当前基线：**30 个 coord id，缺 0**（2026-10-30 21:45 复核，四个确认键改指向专用模板）。
