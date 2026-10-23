**[中文](README.md) | [English](README.en.md)**

# game-daily · hub

Family entry point and shared engine. **It never clicks anything itself**: it routes by game name and
provides the docs, scripts and data formats shared by all modules.

## Contents

| Path | Purpose |
| --- | --- |
| `SKILL.md` | Routing table: Honkai Impact 3 / HI3 → `game-daily-hi`; Star Rail / SR → `game-daily-sr`; ask if the game is not named |
| `engine/adapters.md` | Three execution paths (native / wincu / ps-helper) and the fallback tree |
| `engine/calibration.md` | Calibration protocol (first run, resolution change, re-check) |
| `engine/runbook.md` | The five-beat execution loop and stop conditions |
| `engine/safety.md` | Safety and privacy red lines |
| `engine/coords.schema.json` | Coordinate map format: `id → {rx, ry, desc, note, absolute?}` |
| `engine/daily.schema.json` | Routine format: `steps[] → {id, title, expect, actions[], verify, onMismatch}` |

## Scripts

Zero dependencies, Node ≥ 18, all take `--game <hi|sr|zzz>`.

### `probe.mjs`

```powershell
node scripts/probe.mjs --game hi --pretty
```

Prints: OS / Node / physical screen size (DPI aware) / foreground window / launcher and game processes
(incl. whether elevated) / helper heartbeat / `adapterHints`
(`{native, wincu, psHelper, recommended}`).

### `coords.mjs`

```powershell
node scripts/coords.mjs check     --game hi          # health: missing / uncalibrated
node scripts/coords.mjs resolve   --game hi tasks.open
node scripts/coords.mjs set       --game hi tasks.open 148 307 --note "top-left Tasks"
node scripts/coords.mjs calibrate --game hi          # interactive, writes state/coords.local.json
```

Resolution order: `state/coords.local.json` (measured on this machine) → `references/<m>-coords.json`
(relative references). **Local values are never written back to references.**

### `run-step.mjs`

```powershell
node scripts/run-step.mjs --game hi --step 2       # print step 2's plan (no clicks)
node scripts/run-step.mjs --game hi --all          # the whole routine
node scripts/run-step.mjs --game hi --step 2 --ps  # ps-helper only: actually inject input
```

Every action in the plan carries the resolved absolute coordinates and their source
(`local` / `relative`).

### `peek.mjs`

```powershell
node scripts/peek.mjs --game hi        # past runs and where the last one stopped
```

### `shot.ps1` / `helper.ps1`

```powershell
powershell -NoProfile -File scripts/shot.ps1 -Out state/shots/a.png -RedactUid
powershell -File scripts/helper.ps1 -StateDir <module>\state     # needs RunAs
```

`helper.ps1` protocol: append one command per line to `state/cmd.txt`; results are appended to
`state/out.jsonl`; heartbeat goes to `state/heartbeat.txt`. Commands:
`move / click / dclick / rclick / wheel / activate <hwnd> / key <vk> / type / start / kill / sleep / exit`.

## Data formats

`<m>-coords.json`

```json
{
  "base": { "width": 2560, "height": 1600 },
  "items": {
    "tasks.open": {
      "x": 148, "y": 307, "rx": 0.0578, "ry": 0.1919,
      "desc": "top-left Tasks on the hub",
      "note": "the red dot overlaps the icon's top-right corner"
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
      "title": "hub → Tasks",
      "expect": { "any": ["任务", "活动", "福利"] },
      "actions": [{ "click": "tasks.open" }],
      "verify": { "any": ["作战任务"] },
      "onMismatch": "stop: confirm we are on the hub"
    }
  ]
}
```

## Adding a new game

See “Adding a new game” in the root README: at minimum you need `references/<m>-daily.json`,
`<m>-coords.json`, one row in the `GAMES` table of `probe.mjs`, and one row in this folder's
`SKILL.md` routing table.

## License

[MIT](../LICENSE)
