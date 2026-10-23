**[中文](README.md) | [English](README.en.md)**

# game-daily · hub

家族入口与公共引擎。**它自己不做任何点击**：负责「按关键词选模块」+ 提供两个模块共用的
文档、脚本与数据格式。

## 它包含什么

| 路径 | 作用 |
| --- | --- |
| `SKILL.md` | 路由表：崩坏3/崩三 → `game-daily-hi`；星铁/崩铁/铁道 → `game-daily-sr`；没点名就问一句 |
| `engine/adapters.md` | 三条执行路径（native / wincu / ps-helper）与降级决策树 |
| `engine/calibration.md` | 坐标校准协议（首次运行、换分辨率、复核） |
| `engine/runbook.md` | 五拍执行循环与停止条件 |
| `engine/safety.md` | 安全与隐私红线 |
| `engine/coords.schema.json` | 坐标表格式：`id → {rx, ry, desc, note, absolute?}` |
| `engine/daily.schema.json` | 流程格式：`steps[] → {id, title, expect, actions[], verify, onMismatch}` |

## 脚本

全部零依赖、Node ≥ 18，统一用 `--game <hi|sr|zzz>` 选模块。

### `probe.mjs`

```powershell
node scripts/probe.mjs --game hi --pretty
```

输出：OS / Node / 屏幕物理尺寸（DPI 感知）/ 前台窗口 / 启动器与游戏进程（含是否 elevated）/
提权助手心跳 / `adapterHints`（`{native, wincu, psHelper, recommended}`）。

### `coords.mjs`

```powershell
node scripts/coords.mjs check     --game hi          # 体检：missing / uncalibrated
node scripts/coords.mjs resolve   --game hi tasks.open
node scripts/coords.mjs set       --game hi tasks.open 148 307 --note "主界面左上任务"
node scripts/coords.mjs calibrate --game hi          # 交互式校准，写 state/coords.local.json
```

解析顺序：`state/coords.local.json`（本机实测）→ `references/<m>-coords.json`（相对参考值）。
**本机值永不回写 references**。

### `run-step.mjs`

```powershell
node scripts/run-step.mjs --game hi --step 2       # 打印第 2 步计划（不动鼠标）
node scripts/run-step.mjs --game hi --all          # 全流程
node scripts/run-step.mjs --game hi --step 2 --ps  # 仅 ps-helper 路径：真正发输入
```

计划里每个动作都带解析后的绝对坐标与来源（`local` / `relative`）。

### `peek.mjs`

```powershell
node scripts/peek.mjs --game hi        # 历史轮次、最近一次停在哪儿
```

### `shot.ps1` / `helper.ps1`

```powershell
powershell -NoProfile -File scripts/shot.ps1 -Out state/shots/a.png -RedactUid
powershell -File scripts/helper.ps1 -StateDir <module>\state     # 提权助手（需 RunAs）
```

`helper.ps1` 协议：往 `state/cmd.txt` 逐行写命令，结果追加到 `state/out.jsonl`，
心跳写 `state/heartbeat.txt`。支持
`move / click / dclick / rclick / wheel / activate <hwnd> / key <vk> / type / start / kill / sleep / exit`。

## 数据格式（模块作者看这里）

`<m>-coords.json`

```json
{
  "base": { "width": 2560, "height": 1600 },
  "items": {
    "tasks.open": {
      "x": 148, "y": 307, "rx": 0.0578, "ry": 0.1919,
      "desc": "主界面左上「任务」",
      "note": "红点会遮住图标右上角"
    }
  }
}
```

`<m>-daily.json`

```json
{
  "game": "hi",
  "steps": [
    {
      "id": 1,
      "title": "主界面 → 任务",
      "expect": { "any": ["任务", "活动", "福利"] },
      "actions": [{ "click": "tasks.open" }],
      "verify": { "any": ["作战任务"] },
      "onMismatch": "停手：确认是否在主界面"
    }
  ]
}
```

## 加一个新游戏

见根 README 的「扩展一个新模块」：最少只需 `references/<m>-daily.json` +
`<m>-coords.json` + `probe.mjs` 的 `GAMES` 表加一行 + 本目录 `SKILL.md` 路由表加一行。

## License

[MIT](../LICENSE)
