# NoofGains Beta Crowd — Phase 1 Findings (2026-07-16)

18 AI personas (11 fresh installs, 7 seeded with a 6-week profile) beta-tested the live app
independently — blind to each other, persona-faithful, filing a structured 6-part report each.
Findings were clustered by recurrence (distinct personas hitting the same issue), then
adversarially verified against source by separate agents (2 votes on majors/blockers, file:line
evidence), then the worst ones hand-reproduced in the browser. Full dataset: `findings.json`
(28 verified clusters, per-persona reports, verifier votes). Seed profiles used: `seed-6wk.json`,
`seed-gap.json` (2.5-week lapse variant). Workflow run `wf_8957683e-13f`, 65 agents, ~4.3M tokens.

**Product decision (2026-07-16): NoofGains is a personal app, forever.** General-audience
findings are recorded below as by-design context, not backlog.

## The big three (verified + reproduced live)

1. **Invisible undo strip eats taps and reverts data** (c11/c16/c22 shared root, 6+ personas).
   `toast()` arms `pointer-events:auto` + `onclick=undo` (app.js:16-25); `hideToast()` only drops
   the `.show` class, so after the 4.2s fade an invisible click-active strip sits at z-99 over the
   tab-bar top and sheet Save/Done buttons. Next tap there is swallowed AND fires a stale undo.
   Reproduced live: logged session went 1→0 from tapping where the tab bar visibly is.
   **Fix: disarm in hideToast(). Status: triage.**
2. **Phantom seed weigh-in** (c03/c07, 10 + 7 personas). Fresh installs seed a fabricated
   165 lb / 18% entry dated today (store.js:37); goal setup then anchors plans to it
   (observed live: `startWeight:165` on a brand-new profile, target prefilled 158 = avg−7).
   Only affects fresh boots — existing stored data unaffected. **Status: triage (conditional).**
3. **Hardcoded to Noof** (c01, 18/18 — the only universal finding). Greeting is a string literal
   ignoring `profile.name` (app.js:61-63); no profile UI; About/Coach/Fuel copy assume Dylan.
   **By design (personal app). Triage keeps one piece: greeting reads profile.name.**

## Verified majors

| id | Finding | Rec | Verdict | Personal-app status |
|----|---------|-----|---------|---------------------|
| c04 | Food logging fully behind bring-your-own API key | 10 | CONFIRMED | By design — owner has a key |
| c09 | New users can't find weight logging | 7 | CONFIRMED | By design — Withings automates it |
| c02 | Bulk mode exists (Trends Cut\|Bulk toggle) but goal sheet never mentions it; rejection error misleads | 4 | PARTIAL | **Phase 2** — owner will hit this at cut→bulk flip |
| c10 | Coach tab dead end without key despite offline Signals existing | 6 | CONFIRMED | By design / Phase 2 idea (surface Signals there) |
| c12 | Trends says "X lb behind" and "On pace" simultaneously | 4 | CONFIRMED | **Phase 2** — verdict single-source |
| c14 | Binary logs capture zero detail (all 3 performance personas churned) | 3 | CONFIRMED | Locked decision — revisit in Phase 2 grilling |
| c17 | "End plan" is one tap, no confirm, no undo | 1 | CONFIRMED | **Triage** |
| c18 | No in-app data delete/reset | 1 | CONFIRMED | By design (personal) |
| c13 | Backup UX: alarming eviction copy, buried | 4 | PARTIAL | **Phase 2** |
| c05 | Sheets: "can't be dismissed" largely REFUTED (backdrop works); real kernel = no visible ✕/Escape | 9 | PARTIAL→minor | **Triage** (✕ + Escape) |

## Minors (one line each)

c19 ring copy math reads pre-failed (Phase 2 tone pass) · c20 right-edge clipping at 375px
(triage, cosmetic) · c21 Fuel targets read as actuals (triage: label) · c22 toasts follow across
tabs (fixed by toast root fix) · c23 jargon walls (by design) · c24 red framing punishes steady
progress (Phase 2) · c25 date-boundary wobble near midnight (Phase 2; partly test artifact —
run crossed midnight) · c26 no lapse acknowledgment (Phase 2) · c27 self-navigation to Food
(single report, PARTIAL) · c28 wrong time-of-day greeting (triage) · c29 cosmetic singleton,
unverified by design.

## Corrections from verification (why the pipeline had a refute stage)

- c05's drama ("trapped in sheets", 9 personas) was mostly wrong — backdrop-tap closes every
  sheet (app.js:37). Kernel kept: no visible close affordance.
- c08 ("goal input discards typed value") did NOT reproduce in the main path (typed 150 → saved
  150). One verifier points at the weight/body-fat toggle re-render. Contested; needs narrowing.
- Harness noise: coordinate-clicks sometimes no-oped in sessions, so agents fell back to JS
  clicks. Some "dead tap" reports mix that artifact with the real toast bug; real thumb
  ergonomics remain untested.

## What was NOT tested

Camera/photo check-ins (no camera in harness), push notifications, Withings/steps sync, the AI
food-parse + coach chat themselves (run was keyless by owner's choice), multi-week retention,
PWA install, real touch ergonomics.

## Crowd verdict

16/18 missions completed (Frank f02 lost to the toast loop + key wall; Omar s06 lost to the
bulk trap + unconfirmed End-plan). 7 would delete (single-user hardcoding, key walls);
~6 would keep — every keep cited the same two traits: one-tap logging speed and local-first
privacy. The no-streaks lapse philosophy was praised by the persona built to test it.
