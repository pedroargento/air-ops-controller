# Air Operations Controller v0.1 — Implementation Plan

Implements `air-operations-v0.1-spec.md` (revision 3). The spec decides what the game does; this plan decides build order, structure and exit gates. Section references (§) point to the spec.

## Status

- **M0:** Complete.
- **M1:** Complete; go/no-go gate passed. Abstract air has since been removed. Debug view: `npm run dev`, then open `/debug.html`.
- **M2:** Complete.
- **M3:** Complete; all exit checks met.
- **M4:** Complete. `npm run e2e` plays the Definition of Done in Chromium (`-- --firefox` for Firefox) and replays the session headlessly to the same final hash. It needs `npx playwright install firefox chromium-headless-shell` once and is not part of `npm run check`.
- **M5:** Not started.

Replay works across JavaScript engines, which goes beyond invariant 8. Simulation code uses `src/domain/public/det-math.ts` because built-in `Math.log` and similar functions differ between engines and V8 versions; lint bans them there.

| M3 policy (1,000 seeds) | Win | Captured | Below strength | Target |
|---|---|---|---|---|
| No air | 0% | 100% | 0% | 0 wins |
| Reactive CAS | 57.6% | 12.8% | 29.6% | 15–50% |
| Immediate CAS (diagnostic) | 23.9% | 23.9% | 52.2% | None |
| Recon informed | 91.1% | 1.6% | 7.3% | 55–85% |
| Recon informed, no forwarding | 81.2% | 2.7% | 16.1% | None |

- Informed beats reactive by 33.5 points (95% interval 30.0–37.0); the target is at least 20.
- Forwarding adds 9.9 points (95% interval 7.2–12.6); the target is about 10.

Open items for scenario tuning, which is separate from engine work:

- No-air can still win rarely. The last measured rate was 5 in 20,000 with `successMinDefenders` at 35, and its best deadline result was 40 defenders. The value is now 45, but no-air has only been measured at that value over 1,000 seeds (0 wins).
- Reactive and informed both sit above their target bands, so the scenario is currently a little too easy with air.
- Informed is very sensitive to launch range: about 90% at 800 m or more, and 47.5% at 600 m or less.
- The enemy arrives as one concentrated assault: most formations reach the outpost at about minutes 35–41, and the reserve at about minute 53.

Earlier findings that still apply:

- No-air losses come from morale and casualties under massed attack. Ammunition also matters: more garrison ammunition produced rare no-air wins at the deadline.

## 1. Approach

- **Prove the battle first.** Most of the project's risk is whether the scenario can be balanced at all, so M1 answers that before perception, radio or UI are built.
- **Keep one sim core.** The browser, headless runner and policy bots all drive the same `step()` function.
- **Enforce boundaries with tooling.** Truth separation is checked by lint rules and tests, not by convention.
- **Keep the game headless-first.** Every milestone except M4 is verified from tests and batch runs. The debug canvas exists to inspect behavior, not to play.

## 2. Technical decisions

| Topic | Decision | Reason |
|---|---|---|
| Runtime | Node 26, npm | Already installed |
| Project root | Repo root, no nested `air-operations/` | Repo holds only this project |
| Scenario validation | Zod | Schema and types come from one definition |
| Headless execution | `tsx` CLI scripts | Runs TypeScript directly, needs no build step |
| Random numbers | Small seedable PRNG (PCG32) | Its state serializes into `SimState` and the state hash |
| RNG streams | Forked by label, e.g. `detect/<observer>/<target>` | Unrelated draws can't shift each other's results |
| State hash | FNV-1a over canonical JSON with sorted keys | Simple, and sufficient for replay checks |
| Boundary checks | ESLint `no-restricted-imports` per directory | No extra tool required |
| Banned in sim code | `Math.random`, `Date.now`, `performance.now` | Enforced by ESLint |
| TypeScript flags | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Catches missing-entity bugs at compile time |
| CI | None for now | The repo has no remote; `npm run check` runs everything locally |

## 3. Code structure

This extends the suggested layout in §10 with `ai/`, `debug/` and `cli/`.

```text
src/
  domain/
    public/       # IDs, Vec2, estimates, messages, orders: no hidden state
    truth/        # WorldTruth, true unit state, combat state
  rng/            # PRNG, labeled streams
  sim/            # step(), movement, combat, capture, radio progress, aircraft
  perception/     # truth in, Observation out
  ai/             # decideGround, utility rules, response to information
  knowledge/      # UnitKnowledge, PlayerKnowledge, PlayerView, project(), cone geometry
  scenario/       # Zod schema, ASCII terrain parser, initial-state loader
  policies/       # automated players
  ui/             # player-facing Canvas and panels
  debug/          # omniscient debug canvas, excluded from normal gameplay
  cli/            # batch runner, replay tool, reports
  main.ts
scenarios/
  outpost-under-pressure.json
  outpost-under-pressure/  # ASCII terrain layers
tests/
  unit/  integration/  balance/
```

### Import rules

| Directory | May import | Must not import |
|---|---|---|
| `domain/public` | Nothing outside itself | Everything else |
| `domain/truth` | `domain/public` | Everything else |
| `perception`, `sim`, `scenario` | `domain/*`, `rng`, `ai`, `knowledge` | `ui`, `policies`, `debug`, `cli` |
| `ai`, `knowledge` | `domain/public`, `rng` | `domain/truth`, `sim`, `perception` |
| `policies`, `ui` | `domain/public`, PlayerView types from `knowledge` | `domain/truth`, `sim` internals, `perception` |
| `debug`, `cli` | Anything | Nothing is imported from them except `main.ts` |

`sim` calls `ai` and `knowledge` directly and passes them filtered inputs. The import rules stop those modules reaching truth themselves.

### Core contracts

```ts
type SimState = Readonly<{
  tick: number;
  truth: WorldTruth;
  unitKnowledge: ReadonlyMap<UnitId, UnitKnowledge>; // beliefs, kept apart from truth
  trackAssociation: TrackAssociation;                // private observer/unit map (§5.1)
  radio: RadioState;
  player: PlayerKnowledge;
  rng: RngState;
}>;

step(state: SimState, commands: readonly PlayerCommand[], config: SimConfig):
  { state: SimState; events: readonly SimEvent[] };

project(player: PlayerKnowledge, telemetry: AircraftTelemetry, tick: number): PlayerView;

decideGround(self: UnitSelf, knowledge: UnitKnowledge, terrain: LocalTerrain, tick: number):
  GroundIntent;

type Policy = (view: PlayerView) => readonly PlayerCommand[];
```

`UnitSelf` carries only what a unit can know about itself. That includes true position (§4), but no data about other units.

## 4. Milestones

### M0: Foundations

- Scaffold Vite, TypeScript, Vitest and ESLint, with `npm run check` covering types, lint and tests.
- Add import rules and banned-API rules, with a deliberate violation fixture proving the rules fire.
- Implement PRNG, labeled streams, canonical state hash, and a `step()` that only advances the tick.
- Implement the replay harness: run, record, re-run and compare per-tick hashes.

**Exit:** `npm run check` passes, and a replay of the empty sim matches.

### M1: Ground simulation

1. **Terrain:** Parse ASCII layers and legend into `TerrainGrid`; implement LOS sampling over elevation and obstruction.
2. **Scenario:** Define the Zod schema and author a first draft of the map, formations, objectives, fallbacks and tuning constants.
3. **Movement:** Add A* with fixed tie-breaking, plus terrain and posture movement costs.
4. **Stub perception:** Provide range-and-LOS contacts delivered through `UnitKnowledge`. `decideGround` never sees truth, even in M1.
5. **Ground AI:** Implement `decideGround`, doctrine parameters, posture, and the disengagement, recovery and return rules of §4.2.
6. **Combat:** Implement the formation-level model of §4.1, snapshot-then-apply, with all constants in config.
7. **Outcomes:** Implement capture and success rules (§11), and record outcome statistics.
8. **Abstract air:** Add a test-only strike order that applies casualties and suppression through the combat-effects path. It has perfect target knowledge and is limited to the planned sortie and pass budget.
9. **Debug canvas:** Show true positions, intents and state, with replay of a recorded run.
10. **Batch runner:** Run N seeds, then output a JSON/CSV summary with win rate, time held and losses.

**Go/no-go gate.** All of these must hold over 1,000 seeds:

| Check | Target |
|---|---|
| No-air wins | 0 |
| Abstract air wins, at planned sortie budget | At least 85% |
| Battle shape | Both threats reach contact, and neither side is wiped out in the opening minutes |

The 85% target is deliberately above the final 55–85% band for informed CAS, because abstract air has perfect information. If perfect strikes can't exceed that band, real CAS won't reach it.

**If the gate fails,** adjust in this order: force ratios and ammunition, morale and withdrawal thresholds, terrain and spacing, then air effect per pass. If it still fails after that, stop and revisit §11 with the data rather than starting M2.

### M2: Knowledge

1. **Detection:** Replace the stub with stochastic detection using range, LOS, concealment, target activity and observer quality.
2. **Identification:** Add `unidentified`, `friendly` and `hostile` states, which can be delayed but never wrong (§5.2).
3. **Estimation:** Add contact position error, strength inference, motion estimates, and persistent navigation error.
4. **Tracks:** Add private track association, local contact IDs and the "new information" rule.
5. **Radio tasks:** Implement the task state machine, priorities, delay, interruption and queue rules. Every side uses the same code.
6. **Messages:** Complete the `RadioMessage` union, including CECON's scenario-defined messages and report templates.
7. **Links:** Add configured links, autonomous exchange and relay with original provenance.
8. **Response to information:** Implement §4.3 with doctrine-driven utility rules and expected support.
9. **Player knowledge:** Add `PlayerKnowledge`, evidence rules, supersession within source tracks, and `project()`.
10. **Geometry:** Add marker aging, circles and cones as pure functions.

**Exit:**
- All §12 perception and radio tests pass.
- The non-interference test passes.
- A deterministic test shows an incoming report changing a unit's chosen behavior.
- TICs emerge in unscripted runs.
- The M1 gate is re-run with real perception. Stub perception may have flattered the ground AI, so this is expected to need retuning.

### M3: Air operations

1. **Aircraft:** Add off-map base, takeoff delay, mission state machine, in-flight retasking, fuel, automatic return and per-type turnaround.
2. **Sensors:** Add footprints, air LOS and concealment, and automatic map updates with radio messages only for new or changed contacts.
3. **CAS:** Implement Search, Identify and Engage, recon cueing, discrete passes and observed strike results.
4. **Enemy reaction:** Ground units respond to aircraft they detect, using the shared AI.
5. **Player commands:** Add aircraft orders, contact forwarding, the three information requests, acknowledgements and `CAS inbound`, validated against the previous `PlayerView`.
6. **Policies:** Add no-air, reactive CAS, immediate CAS, recon-informed, and recon-informed without forwarding.
7. **Cleanup:** Remove abstract air.

**Exit:**
- All remaining §12 integration tests pass.
- No-air wins remain at 0 over 1,000 seeds.
- Recon-informed beats reactive CAS.
- The forwarding comparison's confidence interval excludes zero.
- Exact bands aren't required until M5.

### M4: Player interface

1. **Loop:** Add a fixed-step accumulator, pause, 1×/2×/4×/8× speeds, and command queuing while paused.
2. **Map:** Render terrain tint, grid, pan and zoom, aircraft, routes, markers, opacity floor, cones and TIC flags.
3. **Radio panel:** Add the log, clickable coordinates, requests and acknowledgements.
4. **Forwarding flow:** Add contact details, recipient selection, preview and transmit.
5. **Aircraft panel:** Add mission, fuel, ammunition, orders and area selection, plus the selected aircraft's footprint.
6. **Global controls:** Add time, objective and support-request list, plus an end-of-run result.

**Exit:** The full Definition of Done (§14) can be completed by hand in the browser, and the run's command log replays headlessly to the same final hash.

### M5: Calibration

- Tune every policy into its acceptance band, then run sensitivity sweeps on the main constants to find fragile balance.
- Record the communication improvement in percentage points, against the target of about 10.
- Investigate whether ammunition, reinforcement and time limits can guarantee no no-air win.
- Playtest pacing at each speed, and check that real decisions arise often enough.
- Document known simplifications and final tuning values.

**Exit:** All §12 balance targets are met or deliberately revised, and §14 is satisfied.

## 5. Testing

| Layer | When it runs | Contents |
|---|---|---|
| Unit | `npm run check` | §12 domain tests |
| Integration | `npm run check` | §12 integration tests, golden replay hash |
| Quick balance | `npm run check` | About 50 seeds per policy, to catch breakage rather than judge balance |
| Full balance | `npm run balance` | 1,000+ seeds per policy, with a saved report |

Golden replay hashes change whenever rules or tuning change, so a hash update must be a deliberate part of the change that caused it.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Air can't swing the battle while no-air stays at 0 wins | M1 go/no-go gate |
| Real perception undoes M1's balance | Re-run the gate at the end of M2 |
| Ground AI ignores information, so forwarding is pointless | M2 deterministic test, M3 forwarding comparison |
| Ground AI loops between advancing and retreating | Debug canvas, §4.2 return rule, a run metric counting repeat withdrawals |
| Truth leaks into player-facing code | Import rules, non-interference test, policies limited to `PlayerView` |
| Tuning constants multiply and interact | All constants in config, sensitivity sweeps in M5 |
| Abstract air outlives its purpose | Removal is an M3 task |
