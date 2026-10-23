**[中文](README.md) | [English](README.en.md)**

# game-daily-hi · Honkai Impact 3rd daily routine

The HI3 module of the `game-daily` family. **All 14 steps have been run end-to-end on a real machine**
(2026-10-23), including sub-step 5.5 (dorm work).

## What it covers

| # | Step | Key action |
| --- | --- | --- |
| 1 | hub → Tasks | top-left “任务” |
| 2 | Combat tasks · one-key claim | login + stamina rewards |
| 3 | Coin collection (optional) | “前往”; usually already done by step 2 |
| 4 | Dorm → Expedition | bottom “远征” |
| 5 | Finish one expedition → one-key expedition | finish → confirm → one-key → dispatch |
| **5.5** | **Dorm work** | **claim rewards first (only if lit) → one-key work → confirm → back ×2** |
| 6 | Main menu → Tasks → Fleet commissions | — |
| 7 | New commission → one-key apply | 1/10 → 10/10 |
| 8 | Submit → confirm → put into fleet reward pool ×8 | until remaining count hits 0/8 |
| 9 | Claim fleet reward pool | second tab on the right |
| 10 | Main menu → Tasks → Material activities | — |
| 11 | One-key reduce → confirm | costs 67 stamina |
| 12 | Main menu → Tasks → one-key claim | training value 250 → 800 |
| 13 | Daily training 600 | the icon at the **far right** of the bar |

Total runtime on a real machine: **10–12 minutes**.

## Layout

```
SKILL.md              triggers, sections 0–6 (self-check / calibration / 14-step table / pitfalls / stop)
manifest.yaml         always_load: 4 family engine docs + 2 local static docs
references/
  hi-daily.json       14 step definitions (action + expect + verify + onMismatch)
  hi-coords.json      32 coordinate ids (launcher.hi_icon / tasks.open / work.claim_rewards …)
  hi-screens.md       screen-recognition cheat sheet
  screens/            9 reference screenshots
static/core/
  environment.md      processes, windows, UIPI, foreground fights
  runbook-hi.md       judgement calls, ordering, timings, stop list
state/                local runtime state (git-ignored)
```

## Usage

```powershell
cd "$HOME\.agents\skills\game-daily"

node scripts/probe.mjs --game hi --pretty        # environment
node scripts/coords.mjs check --game hi          # missing=0
node scripts/run-step.mjs --game hi --all        # print the 14-step plan
```

Ask the agent *“clear my HI3 dailies”* / *“Honkai Impact 3 daily”* and the hub routes here.

## HI3-specific pitfalls (all met in real runs)

1. **Coin collection is not the dorm capsule.** It is completed by “combat tasks 1/1 → one-key claim”.
   Clicking the “coin” capsule in the dorm opens **stamina refill / take out stamina ×144**.
2. **Work order**: claim rewards first (greyed = not yet 14 hours, skip) → then one-key work.
3. **The work map has no “main menu”**: you must press the top-left “back” twice to return to a page
   with the bottom navigation.
4. **“Coin collection · go” may land on the “recycle commissions” page** — the label does not always
   match the destination; confirm by page title.
5. **Two dialog heights**: `dialog.ok` (1280,1165) vs `popup.ok2` (1280,1142) — do not mix them.
6. **Never click “unlock … pack”** on reward pages (paid).
7. **Keyboard injection is unverified** here: this module uses the mouse only.

## Known untested

- `tasks.clan_go` (fleet commission “go”, 2337,1073): today the commission page was reached via the
  coin-collection button by accident; it is marked `未实测` in the coordinate map and will be pinned
  on the next run.
- Whether HI3 accepts injected keyboard events at all (not relied upon).

## Requirements

- Node ≥ 18 (zero npm dependencies)
- Launcher `E:\miHoYo Launcher\launcher.exe` (process `HYP`, administrator)
- Game `E:\Honkai Impact 3\Games\BH3.exe` (process `BH3`)
- If the game runs elevated, the `ps-helper` adapter (elevated helper) is required to inject the mouse

## License

[MIT](../LICENSE)
