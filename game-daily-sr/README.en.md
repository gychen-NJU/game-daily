**[中文](README.md) | [English](README.en.md)**

# game-daily-sr · Honkai: Star Rail daily routine

The Star Rail module of the `game-daily` family. **All 14 steps have been run end-to-end on a real
machine** (2026-10-23).

## What it covers

| # | Step | Key action |
| --- | --- | --- |
| 1 | Launcher → enter the game | find the SR icon → start → “tap to enter” |
| 2 | Train supply (optional) | claim only if the popup appears |
| 3 | Open the guide (F4) | F4 is ignored while a panel is open — press ESC first |
| 4 | Claim “log in” +100 | — |
| 5 | Commission rewards / dispatch +100 | auto re-dispatch happens; skip if there is no one-key dispatch |
| 6 | Go to “spend 120 trailblaze power” | survival index → cultivation goal |
| 7 | Enter the dungeon | first recommended material → enter |
| 8 | Max runs → challenge | up to 6 runs (40 power each) |
| 9 | Start the fight | auto battle ~2 min 50 s |
| 10 | Leave the dungeon | only “leave”; never “again” |
| 11 | Claim +200 / defeat enemies +100 | activity reaches 500 |
| 12 | Open the 500 gift box | 60 stellar jade etc. |
| 13 | F2 Nameless Honor → missions | second icon on top → one-key claim (y≈1300) |
| 14 | Nameless Honor → rewards | first icon on top → one-key claim |

Total runtime on a real machine: **8–12 minutes**.

## Layout

```
SKILL.md              triggers, 14-step table, SR pitfalls, stop conditions
manifest.yaml         always_load: 4 family engine docs + 2 local static docs
references/
  sr-daily.json       14 step definitions
  sr-coords.json      coordinate map (22 entries, incl. guide.task_claim_c2/c3 and a placeholder)
  sr-screens.md       screen-recognition cheat sheet (16 screens)
  screens/            9 reference screenshots (incl. the launcher SR icon)
static/core/
  environment.md      processes, UIPI, foreground
  runbook-sr.md       keys, timings, pitfalls
state/                local runtime state (git-ignored)
```

## Usage

```powershell
cd "$HOME\.agents\skills\game-daily"

node scripts/probe.mjs --game sr --pretty
node scripts/coords.mjs check --game sr
node scripts/run-step.mjs --game sr --all
```

Ask the agent *“clear my Star Rail dailies”* / *“星穹铁道每日”* and the hub routes here.

## Star Rail-specific pitfalls

1. **F4 / F2 only work inside the game world**: close any open panel with `ESC` first.
2. **Commission rewards auto re-dispatch** (4/4, 0/30 h). No “one-key dispatch” button is normal.
3. **Nameless Honor “one-key claim” sits at y≈1300**, not at the visual centre (~1380) — the easiest
   place to miss.
4. **“Tap to enter” may raise “login error 1001_1”**: no proxy on this machine; it is transient —
   confirm and tap again.
5. **Only click “leave dungeon”**: “again” spends more power.
6. **The launcher icon is not at a fixed position**: identify it by artwork plus the hover tooltip.

## Requirements

- Node ≥ 18
- Launcher `E:\miHoYo Launcher\launcher.exe` (`HYP`)
- Game `E:\Star Rail\Game\StarRail.exe` (requireAdministrator → needs the elevated helper to inject)

## License

[MIT](../LICENSE)
