# 执行循环（runbook）

本家族的技能不是"一键脚本"，而是**agent 按流程执行 + 人可随时接管**。每一次点击都必须有"看—点—再看"的闭环。

## 1. 五拍循环

```
① shot     抓实时截图（locate --window 自带抓图；不复用上一轮/旧图）              ← R1
② 认屏     核对 expect + <m>-screens.md 的必见文案（关键文案/版式在不在）         ← R2
③ 定位     用模板找目标：score ≥ 0.72 才拿到 (cx,cy)                              ← R3
           同形按钮先 locate 锚点模板，再按 offset × scale 算按钮中心               ← R9
④ 执行     click 屏幕坐标 = capture.clientOrigin + (cx,cy)；必要时先 activate     ← R8
⑤ 复检     再抓一张图确认状态真的变了；score/scale/坐标写进 state/runs/            ← R6
```

**坐标表不再是这一环里的"解析目标"**：`*-coords.json` / `*-layout.json` / `coords.local.json`
只用来给 `locate` 限定 `--region`（R4），**不能**拿来点击。规则全文见 `../SKILL.md` §2.2（R1–R9）。

任何一拍失败 → 停在第 5 节的"停手条件"，不要继续往下点。

## 2. 流程文件（模块的 `references/<game>-daily.json`）

```json
{
  "game": "sr", "version": 1,
  "base": { "w": 2560, "h": 1600 },
  "steps": [
    {
      "id": 2, "name": "F4 打开指南",
      "expect": { "all": ["星际和平指南", "每日实训"] },
      "actions": [ { "do": "key", "vk": 115 }, { "do": "wait", "ms": 1500 } ],
      "verify": { "any": ["每日实训", "活跃度"] },
      "onMismatch": "stop",
      "optional": false
    }
  ]
}
```

字段语义：

| 字段 | 说明 |
|---|---|
| `expect.all` | 全部命中才算"来到这一步的界面"；命中不了 → 按 `onMismatch` 处理 |
| `verify.any` | 执行后复检，任一命中即"这步成功" |
| `optional: true` | 界面不存在就跳过（例如月卡弹窗） |
| `onMismatch` | `stop`（默认，停下来问）/ `skip` / `retry1`（重试一次） |

## 3. 动作 DSL

| `do` | 参数 | 说明 |
|---|---|---|
| `click` | `coord`（目标 id） | 左键单击该 **目标 id** 对应的控件：先用 `references/templates/<id>.png` 定位（R3），命中才点；同形按钮按锚点+偏移（R9）。**不再接受 `x,y` 字面坐标**——坐标表只能给 `--region`（R4） |
| `move` | 同上 | 悬停（触发 tooltip / 高亮） |
| `key` | `vk` | 按一次键 |
| `wait` | `ms` | 等待（动画/加载） |
| `shot` | `name` | 存一张带语义名字的截图到 `state/shots/` |
| `fg` | `target: "game" \| "launcher"` | 抢前台（ps-helper 用原子序列） |

**禁止**在 DSL 里写"循环刷本/自动战斗判胜负"这类逻辑：胜负由 agent 看图判定，超时就停手。

`coord` 里填的是**目标 id**（对应 `references/templates/<id>.png`），不是坐标；模板缺失 = 这一步不可执行
（停手或按 §2.4 用 computer-use 手推），**不许**退回坐标表点击。

## 4. 记账

每步执行后追加到 `state/runs/YYYY-MM-DD.json`（同一天多条，**不要覆盖**已有数组）：

```json
{ "step": 3, "ts": "…", "adapter": "wincu",
  "target": "guide.task_claim",
  "locate": { "found": true, "score": "…", "scale": "…", "cx": "…", "cy": "…",
              "clientOrigin": { "x": "…", "y": "…" },
              "screenClick": { "x": "…", "y": "…" } },
  "shots": { "before": "state/shots/<date>/step3-1-before.png",
             "after":  "state/shots/<date>/step3-1-after.png" },
  "verify": "pass", "note": "活跃度 0→100" }
```

字段值填**实测**（示例里的 `…` 是占位，别照抄数字）。`found=false` 时的 `score` 是最有价值的排查数据。

`peek.mjs` 可以把这些记录读成一张表（`node scripts/peek.mjs --game sr`）。

## 5. 停手条件（必须停下来报告，不许硬试）

1. `expect` 对不上（界面变了 / 版本更新 / 弹窗挡路）；
2. 同一个目标点**连续两次**点击后画面没变化；
3. 出现 UAC / 权限不足 / 输入被拦截；
4. 出现付费按钮（"解锁无名客的勋礼"）、删除/重置类按钮、或任何要花真钱的确认框；
5. 需要判断资源是否足够、是否要继续花体力而流程没写明；
6. 用户随时说停；
7. `locate` 找不到目标（`found=false` 或 `score < 0.72`）且重试一次仍失败、模板文件缺失、
   或截图全黑/明显是旧帧（R3 / R7）。

停下来时输出三件事：**卡在哪一步、屏幕现在什么样（截图路径）、建议用户怎么做**。

## 6. 中途恢复

- 先 `peek.mjs` 看今天跑到哪一步；
- 再 `shot` 看当前界面，用 `expect` 反查"现在处在第几步的界面"；
- 从对上号的那一步继续，**不要**从头重跑（会重复领奖/重复消耗体力）。
