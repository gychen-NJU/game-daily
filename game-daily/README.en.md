**[中文](README.md) | [English](README.en.md)**

# game-daily · hub

Family entry point and shared engine. **It never clicks anything itself**: it routes by game name and
provides the docs, scripts and data formats shared by all modules.

## Contents

| Path | Purpose |
| --- | --- |
| `SKILL.md` | Routing table: Honkai Impact 3 / HI3 → `game-daily-hi`; Star Rail / SR → `game-daily-sr`; ask if the game is not named |
| `engine/adapters.md` | Three execution paths (native / wincu / ps-helper) and the fallback tree |
| `engine/calibration.md` | Priors and template self-check (coordinates are search priors only; clicks come from visual location) |
| `engine/layout.md` | Anchor layout model (`anchor + offset × scale`; offset units are 1080p client pixels) |
| `engine/runbook.md` | The five-beat loop (shot → recognise → locate → click → re-check) and stop conditions |
| `engine/safety.md` | Safety and privacy red lines |
| `engine/coords.schema.json` | Coordinate map format: `id → {rx, ry, desc, note, absolute?, screen?}` (R5 requires `screen`) |
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
node scripts/coords.mjs resolve   tasks.open --game hi --screen 1920x1080 --json
node scripts/coords.mjs set       tasks.open 148 307 --game hi --note "top-left Tasks"
node scripts/coords.mjs calibrate --game hi          # interactive: tag priors (still needs a template match to click)
```

Resolution order: `state/coords.local.json` (measured here; **every entry must carry `screen:{w,h}`**) →
`references/<m>-coords.json` (relative references). **Local values are never written back to references.**

⚠️ `resolve` output is a **search prior** (for `locate --region`), **not a click coordinate** (R4).

### `locate.mjs` / `locate.ps1`

```powershell
node scripts/locate.mjs --window "Honkai Impact 3" `
  --template "<module>\references\templates\<id>.png" --threshold 0.72 --json
```

Prints `{ok, found, score, scale, x, y, cx, cy, capture{method, window, clientOrigin}, ...}`;
**`exit 2` = not found (fail-closed, do not click)**. Screen click = `capture.clientOrigin + (cx,cy)`.
The `--image` form is for offline diagnosis only (no `clientOrigin`, so no screen-coordinate mapping).

### `layout.mjs`

```powershell
node scripts/layout.mjs resolve --layout "<module>\references\hi-layout.json" --screen 1920x1080 --item tasks.open --json
```

Prints `{id, x, y, screen, scale, anchor, offset:{dx,dy}, scaleMode, clamped}`; `x,y` only helps pick a
`--region` — it is not a click coordinate. Model and `check/fit/export`: `engine/layout.md`.

### `run-step.mjs`

```powershell
node scripts/run-step.mjs --game hi --step 2       # print step 2's plan (no clicks)
node scripts/run-step.mjs --game hi --all          # the whole routine
node scripts/run-step.mjs --game hi --step 2 --ps  # rehearsal: clicks the priors, violates R4 — not for routine use
```

Every action carries a **target id** plus a prior coordinate (`local` / `relative`). A prior may only seed a
`--region`; **never click it** (R4). Real click coordinates come from `locate`.

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
`<m>-coords.json`, `<m>-layout.json`, one row in the `GAMES` table of `probe.mjs`, and one row in this
folder's `SKILL.md` routing table. For scripted clicks also add `references/templates/`: one png per
clickable id, plus `<id>.anchor.png` and a 1080p-calibrated offset for same-shape row buttons (R9).
**Without templates, fall back to computer-use by hand — never to clicking priors.**

## License

[MIT](../LICENSE)
