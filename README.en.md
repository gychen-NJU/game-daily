**[中文](README.md) | [English](README.en.md)**

# game-daily

> Agent skills that perform the **fixed daily routines** of miHoYo games inside the real game UI:
> executable step tables + coordinate maps + screen-recognition guards, so an AI agent can click
> through a daily routine **with a screenshot check at every step — it can stop, calibrate, and
> adapt to a different machine**.

Two executable modules so far:

| Module | Game | Status |
| --- | --- | --- |
| `game-daily-hi` | Honkai Impact 3rd | ✅ 14 steps, run end-to-end on a real machine (incl. sub-step 5.5 "work") |
| `game-daily-sr` | Honkai: Star Rail | ✅ 14 steps, run end-to-end on a real machine |
| `game-daily-zzz` | Zenless Zone Zero | ⏸ paused: ACE drops synthetic input; docs only |

---

## The problem it solves

A game's daily routine is "a few dozen fixed clicks plus a handful of judgements". Letting a model
just "look at the screen and click somewhere" fails in three predictable ways:

1. **Coordinates drift** — different resolution, window mode or DPI breaks every hard-coded point;
2. **Wrong screen** — dialogs block the view, event banners appear, and a button's label may not
   match where it actually takes you;
3. **Unknown environment** — some hosts ship computer-use, some need a plugin, some can only fall
   back to PowerShell.

Three design decisions answer those:

- **Relative coordinates + per-machine calibration.** Reference values are stored relative to a
  2560×1600 base; the local values live in `state/coords.local.json` and never enter version control.
- **Screen recognition first.** Every step declares what text must be visible. If it does not match,
  the run stops — no blind clicking.
- **Three adapters, auto-detected.** `native` (host computer-use) / `wincu` (DSH plugin) /
  `ps-helper` (elevated PowerShell helper), chosen by `probe.mjs`.

---

## Install

The repository *is* the skills layout — copy the three folders into your agent skills root:

```powershell
git clone https://github.com/gychen-NJU/game-daily.git
Copy-Item game-daily\game-daily    "$HOME\.agents\skills\" -Recurse
Copy-Item game-daily\game-daily-hi "$HOME\.agents\skills\" -Recurse
Copy-Item game-daily\game-daily-sr "$HOME\.agents\skills\" -Recurse
```

```bash
git clone https://github.com/gychen-NJU/game-daily.git
cp -r game-daily/game-daily* ~/.agents/skills/
```

Claude Code / Codex and friends: copy into `~/.claude/skills`, `~/.codex/skills`, etc.

> The three folders must stay **siblings**: `game-daily/` is the family hub and the modules reference
> it through `../game-daily/...`.

Requirements: **Node ≥ 18** (scripts have zero npm dependencies); the `ps-helper` path needs Windows
PowerShell 5.1.

---

## Quick start

```powershell
cd "$HOME\.agents\skills\game-daily"

# 1) environment check: processes / screen / helper / adapter hints
node scripts/probe.mjs --game hi --pretty

# 2) coordinate health check
node scripts/coords.mjs check --game hi
#   game=hi steps=14 referenced=26 missing=0 uncalibrated=26
#   screen=2560x1600 base=2560x1600 matches=true

# 3) print the whole plan (no clicks)
node scripts/run-step.mjs --game hi --all

# 4) first run on this machine: calibrate
node scripts/coords.mjs calibrate --game hi
node scripts/coords.mjs set tasks.open 148 307 --game hi --note "top-left Tasks on the hub"

# 5) history
node scripts/peek.mjs --game hi
```

Then just ask the agent: *“clear my Honkai Impact 3 dailies”* or *“run the Star Rail daily by the
doc”* — the hub routes by keyword.

---

## Architecture

```
game-daily/                 family hub: SKILL.md routing + engine/ + scripts/
├── engine/
│   ├── adapters.md         three execution paths and the fallback decision tree
│   ├── calibration.md      coordinate calibration protocol
│   ├── runbook.md          the five-beat execution loop
│   ├── safety.md           safety and privacy red lines
│   └── *.schema.json       schemas for coords / daily
└── scripts/                zero-dependency Node scripts
    ├── probe.mjs           environment probe
    ├── coords.mjs          check / calibrate / set / resolve
    ├── run-step.mjs        print a plan; with --ps it actually injects input
    ├── peek.mjs            history and state
    ├── shot.ps1            screenshot (can redact UID)
    └── helper.ps1          elevated PowerShell input helper

game-daily-hi/              Honkai Impact 3 module
game-daily-sr/              Star Rail module
├── SKILL.md                module doc: triggers, step table, pitfalls, stop conditions
├── manifest.yaml           declares always-loaded docs and scripts
├── references/
│   ├── <m>-daily.json      step definitions (action + expect + verify + onMismatch)
│   ├── <m>-coords.json     coordinate map (id → relative coords + notes)
│   ├── <m>-screens.md      screen-recognition cheat sheet
│   └── screens/            reference screenshots
├── static/core/            environment and runbook details
└── state/                  local runtime state (git-ignored)
```

**Five beats per step**: `screenshot → recognise → resolve coordinates → act → re-verify`.
If any beat does not match, stop and report *which step / what the screen shows / what to do next*.

---

## Adapters

| Adapter | When | Input path |
| --- | --- | --- |
| `native` | Claude Code / Codex / any host with computer-use | host tools directly |
| `wincu` | DSH + the `dsh-computer-use-win` plugin | `mcp__wincu__windows_computer_use_*` |
| `ps-helper` | any Windows host (fallback) | elevated PowerShell polling `state/cmd.txt` |

`ps-helper` exists because many games run **as administrator**: synthetic input from a normal-integrity
process is dropped by UIPI (the click simply does nothing, or you get
`Windows rejected cursor positioning`). The helper is started with one UAC prompt and then injects
`mouse_event` / `keybd_event` from an elevated process.

---

## Known limits

- **Coordinates are references.** Re-calibrate after changing resolution, changing to/from fullscreen,
  or changing DPI.
- **UIs change with patches.** If recognition fails, stop and update the step — do not click blindly.
- **Keyboard injection**: verified on Star Rail; not verified on HI3, so that module only uses the mouse.
- **Zenless Zone Zero**: ACE discards injected input (`SendInput` returns 0, low-level hooks see
  `LLKHF_INJECTED`). Documentation only.
- **Foreground fights**: DSH keeps stealing focus, which sends clicks to the wrong window. The known
  workaround is minimising DSH before operating the game.

---

## Adding a new game

1. Copy `game-daily-hi/` to `game-daily-<new>/`;
2. Write `references/<new>-daily.json` and `<new>-coords.json` following the schemas;
3. Add one row to the `GAMES` table in `scripts/probe.mjs` (launcher / game process names);
4. Verify: `coords.mjs check --game <new>` must report `missing=0`, and `run-step.mjs --all` must
   print every step;
5. Add the trigger keywords to the routing table in `game-daily/SKILL.md`.

---

## Privacy and safety

- Screenshots and run logs stay local in `state/` (git-ignored). Redact the in-game UID and unrelated
  windows before sharing anything.
- Never auto-click paid bundles ("unlock … pack"), delete or reset buttons.
- One UAC prompt at a time, explained to the user first; if declined, hand over a manual checklist.
- This project contains **no** game assets, credentials or piracy material — only UI coordinates and
  click order.

## License

[MIT](LICENSE) © 2026 gychen-NJU
