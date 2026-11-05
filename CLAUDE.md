# Air Operations

A browser game where you are an air operations controller: ground units fight on their own, and you allocate a few aircraft from late, imperfect reports.

Read these before changing anything:

- `DESIGN.md`: the philosophy, the invariants every change must keep, and the decisions already made, with their reasons. Don't reopen a recorded decision without saying so.
- `implementation-plan.md`: the status of every milestone, the current balance, open items, and what comes next.
- `air-operations-v0.1-spec.md`: the rules of each system, by section (§8.7 night, §8.8 rescue). A new rule gets a spec section before code.

## Commands

- `npm run dev` runs the game; `npm run check` runs types, lint and all unit and integration tests, and must pass.
- `npm run e2e` plays the game in Chromium; run it for anything the interface touches.
- `npx tsx src/cli/batch.ts --scenario <name> --policy all --seeds 300` measures a scenario with its bots. Measure before and after a rule change.
- `npm run params` regenerates `docs/parameters.md` after changing `scenarios/rules/standard.json`. `npm run manual` rebuilds the PDF manual.

## Rules that bite

- Never read truth (`src/domain/truth`, `src/sim`) from the interface, bots, ground AI or crews. Lint enforces the import boundaries.
- Simulation code must stay deterministic: labeled RNG streams, `det-math.ts`, no `Math.random` or `Date.now`. Update the golden hash in `tests/integration/replay.test.ts` only as a deliberate part of a rule change.
- After a change, record the result (with figures and sample size) in the plan, and add a line to `CHANGELOG.md`.
- Commit or push only when asked. Never commit `10_2024-09-16_22-23-34.jpg` or the manual's PDF.
