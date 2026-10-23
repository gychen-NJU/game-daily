# 执行循环（runbook）

本家族的技能不是"一键脚本"，而是**agent 按流程执行 + 人可随时接管**。每一次点击都必须有"看—点—再看"的闭环。

## 1. 五拍循环

```
① shot     截图（带 windowTitle / 或全屏）
② 认屏     看图核对 expect（关键文案 / 关键控件在不在）
③ 解析     用 coords.mjs resolve 把 coord id 换成当前机器的绝对坐标
④ 执行     move → click（或 key），必要时先 fg 抢前台
⑤ 复检     再截一张图，确认状态真的变了；把结果写进 state/runs/
```

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
| `click` | `coord`（id）或 `x,y` | 左键单击；坐标必须能解析，解析不了就报错 |
| `move` | 同上 | 悬停（触发 tooltip / 高亮） |
| `key` | `vk` | 按一次键 |
| `wait` | `ms` | 等待（动画/加载） |
| `shot` | `name` | 存一张带语义名字的截图到 `state/shots/` |
| `fg` | `target: "game" \| "launcher"` | 抢前台（ps-helper 用原子序列） |

**禁止**在 DSL 里写"循环刷本/自动战斗判胜负"这类逻辑：胜负由 agent 看图判定，超时就停手。

## 4. 记账

每步执行后追加到 `state/runs/YYYY-MM-DD.json`：

```json
{ "step": 3, "ts": "...", "adapter": "wincu",
  "resolved": { "guide.task_claim": {"x":540,"y":1182,"source":"local"} },
  "shot": "state/shots/2026-10-23-step3.png",
  "verify": "pass", "note": "活跃度 0→100" }
```

`peek.mjs` 可以把这些记录读成一张表（`node scripts/peek.mjs --game sr`）。

## 5. 停手条件（必须停下来报告，不许硬试）

1. `expect` 对不上（界面变了 / 版本更新 / 弹窗挡路）；
2. 同一个目标点**连续两次**点击后画面没变化；
3. 出现 UAC / 权限不足 / 输入被拦截；
4. 出现付费按钮（"解锁无名客的勋礼"）、删除/重置类按钮、或任何要花真钱的确认框；
5. 需要判断资源是否足够、是否要继续花体力而流程没写明；
6. 用户随时说停。

停下来时输出三件事：**卡在哪一步、屏幕现在什么样（截图路径）、建议用户怎么做**。

## 6. 中途恢复

- 先 `peek.mjs` 看今天跑到哪一步；
- 再 `shot` 看当前界面，用 `expect` 反查"现在处在第几步的界面"；
- 从对上号的那一步继续，**不要**从头重跑（会重复领奖/重复消耗体力）。
