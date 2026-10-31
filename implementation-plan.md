# Air Operations Controller v0.1 — Implementation Plan

Implements `air-operations-v0.1-spec.md` (revision 11). The spec decides what the game does; this plan decides build order, structure and exit gates. Section references (§) point to the spec.

## Status

- **M0:** Complete.
- **M1:** Complete; go/no-go gate passed. Abstract air has since been removed. Debug view: `npm run dev`, then open `/debug.html`.
- **M2:** Complete.
- **M3:** Complete; all exit checks met.
- **M4:** Complete. `npm run e2e` plays the Definition of Done in Chromium (`-- --firefox` for Firefox) and replays the session headlessly to the same final hash. It needs `npx playwright install firefox chromium-headless-shell` once and is not part of `npm run check`.
- **M5:** Rules and scenario roles are implemented. Its exit is **not met**: no-air won 2 of 1,000 runs, and the tempo targets are only partly reached.
- **M6:** Complete; all exit checks met. Forwarding is neutral, not yet the gain it should be.
- **M7:** Implemented, and all automated exit checks are met. The exit's human playtest is still owed, and it decides M8.
- **M7.5:** Implemented, and all automated exit checks are met. The human playtest is still owed, and it decides M8.
- **M7.55:** Complete. It also fixed garrisons rarely getting SITREPs out in heavy fighting, because contact reports always went first.
- **M7.6:** Complete as engine work. Whether masking pays is now a scenario question, to test on a map built for it.
- **M7.7:** Complete.
- **M7.8:** Complete. Scout and gunship teamwork (pink teams) would suit a later scenario.
- **M7.9:** Complete.
- **M8:** Skipped for now. Squad-level detail didn't earn its cost from the air controller's seat. Aircraft variants come first.
- **M9:** Not started.

Replay works across JavaScript engines, which goes beyond invariant 8. Simulation code uses `src/domain/public/det-math.ts` because built-in `Math.log` and similar functions differ between engines and V8 versions; lint bans them there.

| Policy, after M7.9 (1,000 seeds) | Win | Captured | Below strength | Aircraft hits per run | Target |
|---|---|---|---|---|---|
| No air | 0.3% | 86.9% | 12.8% | 0.00 | 0 wins |
| Reactive CAS | 17.4% | 32.1% | 50.5% | 0.33 | 15–50% |
| Immediate CAS (diagnostic) | 28.7% | 25.2% | 46.1% | 0.24 | None |
| Recon informed | 61.0% | 13.0% | 26.0% | 0.59 | 55–85% |
| Recon informed, no forwarding | 45.7% | 17.4% | 36.9% | 0.59 | None |
| Recon informed, threat-blind | 74.0% | 4.8% | 21.2% | 0.57 | None |
| Threat-blind, recon climbs after fire | 71.4% | 5.3% | 23.3% | 0.41 | None |
| Threat-blind, recon climbs, CAS pop-up | 70.7% | 7.0% | 22.3% | 0.52 | None |
| Threat-blind, flies to suit the forecast | 75.6% | 4.9% | 19.5% | 0.58 | None |

- Informed beats reactive by 43.6 points (95% interval 39.9–47.3); the target is at least 20.
- Forwarding adds 15.3 points (95% interval 11.9–18.7); the target is about 10.

Graded visibility cost every air policy 1–10 points of wins against the rain-and-cloud rules it replaced, with no-air unchanged at 0.3%, so weather now matters to the result.

M7 removed an aircraft aura that had inflated every earlier result. Each sighting used to restart a 30-second take-cover reaction, so assault formations spent 46% of their steady time held by any nearby aircraft, even one with no ordnance. Formations now take cover once and can't again for 5 minutes. Most of air's earlier value came from that aura: with it gone, reactive fell to 3%. CAS passes were then roughly doubled in strength. So win rates before M7 aren't comparable with these.

Forwarding probably helps now because the aura no longer dominates, so warned patrols and prepared garrisons can show up in the result. That explanation hasn't been tested.

Open items for M9, most important first:

- **Hunting air defense doesn't pay.** The `informed` policy wins 61.0%, against 74.0% for threat-blind, because it spends passes on the team. Answering fire by climbing recon cuts hits (0.41 per run against 0.57) with no significant change in wins (71.4%), so altitude is the better reaction for now.
- **Reactive and informed are both inside their bands,** but reactive (17.4%) is now near the bottom of its band. The best policies reach the mid 70s, so a good human may still find the scenario too easy.
- **Forecasts don't clearly pay yet.** Flying to suit the forecast wins 75.6% against 74.0% for ignoring it, which is within noise, even though weather now costs real wins. Altitude may be too blunt a response, and the policy doesn't yet route or time missions around storms.
- **Immediate CAS (28.7%) beats reactive (17.4%).** Simply launching at the first report shouldn't beat answering requests, so this diagnostic needs watching.
- **Forwarding is above its 10-point design target,** which may mean it is now too strong.
- **No-air still wins rarely** (0.3%). These are real wins: the garrison beats the waves in detail, so `successMinDefenders` can't remove them. M5's exit stays unmet.
- **Fire is too continuous:** 73% of minutes without air against a 30–50% target, and 4 bouts against at least 5. The first decisive assault is at minute 43.4, against about 45.
- `probe` is about 2% of behavior time, almost all of it scouts.
- **Scenario win conditions need a rethink.** "Below strength" is hidden from the player, and it counts a recovering unit as zero defenders. Over 400 seeds, counting all but broken units would take reactive from 10.5% to 24.3% and informed from 34.0% to 50.7%, with no-air barely moving (0.5% to 0.8%). An alternative is a report card on the outpost's status when a relief force arrives. This is scenario work, not engine work.

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
- Exact bands aren't required until M9.

### M4: Player interface

1. **Loop:** Add a fixed-step accumulator, pause, 1×/2×/4×/8× speeds, and command queuing while paused.
2. **Map:** Render terrain tint, grid, pan and zoom, aircraft, routes, markers, opacity floor, cones and TIC flags.
3. **Radio panel:** Add the log, clickable coordinates, requests and acknowledgements.
4. **Forwarding flow:** Add contact details, recipient selection, preview and transmit.
5. **Aircraft panel:** Add mission, fuel, ammunition, orders and area selection, plus the selected aircraft's footprint.
6. **Global controls:** Add time, objective and support-request list, plus an end-of-run result.

**Exit:** The full Definition of Done (§14) can be completed by hand in the browser, and the run's command log replays headlessly to the same final hash.

### M5: Ground behavior

Implements §4.0–§4.3, §6.2.1 and the pacing rules in §11. Win rates will move, and that is expected until M9.

1. **Tempo metrics first:** Add the §12 tempo measures to `runBattle` and the batch report, including withdrawal trigger, engagement duration, suppression recovery and warning time. Record the baseline before changing any rule.
2. **Separate morale:** Replace the per-volley under-fire loss in `src/sim/combat.ts` with a floor that fire alone can't pass, add isolation and deteriorating conditions, and let morale recover slowly out of contact in any mode.
3. **Tactical behaviors:** Add `GroundBehavior` and a shared choosing function to `decideGround`. Add fire intensity to the `engage` intent, doctrine fields for standoff, probe length and commitment time, and a standoffish patrol doctrine.
4. **Threat-based TICs:** Replace `inContact` in `src/ai/report.ts`, which stays true for any nearby hostile once a unit has fired at all. Use separate rules for a TIC and for a support request.
5. **Information reactions:** Let received reports and real expected support feed behavior choice, including preparing defenses and reassessing an advance, with no effect on objectives.
6. **Scenario roles:** Add objective schedules, then give enemy formations reconnaissance, harassment, assault and reserve roles, with assembly areas that reconnaissance can find early.
7. **Adapt policies:** `reactiveCas` waits for requests that will now be rarer, so check that it still measures what it was meant to.

**Exit:** Unit tests from §12 pass, the go/no-go gate is re-run with no air at 0 wins over 1,000 seeds, and the tempo report shows staged contact with no behavior dominating. Balance bands are not an M5 exit.

### M6: Equipment

Implements §4.2.1 on the existing units, with no change to unit size or hierarchy. The goal is the same battle expressed through equipment, so combat constants move into weapon definitions rather than being retuned.

1. **Definitions:** Add `WeaponType`, `WeaponDefinition` and `Equipment`, with weapon definitions and unit inventories in the scenario file and schema.
2. **Ground combat:** Replace the single volley and ammunition pool with per-weapon fire. Small arms stay aggregated with personnel; machine guns are individual systems that add suppression.
3. **Losses:** Let casualties destroy specialist systems, using a labeled RNG stream, and apply crew requirements.
4. **AI and reports:** Feed equipment into behavior choice, and derive SITREP ammunition from the inventory.
5. **Estimates:** Add `observedWeapons`, shown in contact details and forwarded unchanged.
6. **Forwarding check:** Re-measure the forwarding benefit. If it is still negative, find the cause and fix it before M7, because aircraft damage would make the numbers harder to read.

**Exit:** §12 equipment tests pass, the tempo report stays close to the M5 shape, and forwarding is no longer harmful.

### M7: Air threat

Implements §8.3.

1. **Altitude:** Add `altitudeMeters` to aircraft and telemetry, with a scenario operating altitude and 0 on the ground. Show it in the aircraft panel.
2. **Fire decision:** Add the fire-or-stay-concealed choice to the shared decision, using the existing aircraft-notice rule.
3. **Ground fire:** Resolve three-dimensional range, altitude limits and hit chance on the tactical update, with a labeled RNG stream.
4. **Damage:** Add the damaged state, automatic RTB, repair turnaround and `CAS inbound` correction.
5. **Player feedback:** Add the fired-on report, its map effect and the damage telemetry.
6. **Exposure:** Raise detectability of firing units from the air, and reveal observed weapons.
7. **Scenario:** Add a small hidden anti-aircraft team, then add at least one automated policy that reacts to damage and known threats.

**Exit:** §12 air-threat tests pass, the browser check covers a damaged aircraft, a hidden team damages aircraft in a measurable share of runs, and a playtest answers the M7 question. That answer decides whether M8 goes ahead.

### M7.5: Altitude

Implements altitude in §8.3 and the profile in §9.

1. **Simulation:** Add target altitude, climb rates and type limits, with `setAltitude` as its own replayable command.
2. **Costs:** Scale sensor quality with altitude, add altitude to strike miss distance, and let ordinary formations fire on low aircraft.
3. **Profile:** Replace the aircraft rows with a shared altitude profile, keeping status, fuel and ordnance, with ceilings for observed weapons only.
4. **Threat ring:** Follow the most recently selected aircraft's altitude.
5. **Policy:** Add a policy that climbs after being fired on, to measure whether altitude pays.

**Exit:** §12 altitude tests pass, the browser check covers setting altitude, and climbing is a real option: it reduces hits, and at least one role can do it at no cost. CAS climbing still costs more than it saves. That's an accepted limit of having one CAS type, and aircraft variants are the expected fix. The M7 playtest moves here, since altitude changes how a player answers ground fire.

### M7.55: Situational awareness

Implements §7's consolidation, contact status and archive rules, and the summary and debrief in §9. Periodic SITREPs to CECON were left out for now: the Summary tab holds the same picture, and sending it needs a new message path.

### M7.6: Terrain and aircraft

Implements §8.4. Happens after the M7.5 playtest, because it changes balance again.

1. **Map view:** Hillshading, contours and elevation on hover. Done.
2. **Altitude datum:** Measure altitude from the datum, with automatic terrain clearance. The profile's scale and ceilings need rethinking, since ceilings now depend on where the weapon stands.
3. **Line of sight:** Generalize the ground check to any two heights, then use it for sensors, noticing, ground fire and CAS passes.
4. **Terrain:** Regenerate the scenario with relief of a few hundred meters, then recheck ground line of sight and pacing, because taller hills change the ground war too.
5. **Path profile:** Terrain along the selected aircraft's path, in a strip under the map.
6. **Policy:** Add a policy that approaches masked and rises to strike, to measure whether flying low pays.

**Exit:** §12 terrain tests pass, the masked policy reduces hits without losing wins, and CAS flying low is a real option.

**Result:** The engine work is done, and the masking part of this exit moved to scenario design. Terrain blocks fire and sensors as designed. The pop-up policy (100 m in transit, 650 m on station) wins 42.1% with 0.43 hits, against 46.8% and 0.57 for threat-blind, and recon climbing alone does better on both (44.8%, 0.39). Flying low all the time took hits to about 2.3 per run in a 300-seed test, because small arms and machine guns reach CAS over assault formations. The scenario's hills are around the outpost, with the air defense team on the same slope as its targets, so there's little to hide behind. Whether masking pays is probably a scenario-placement question, which M9 or a new scenario should test.

### M7.7: Aircraft models

Implements §8.5. Aircraft are defined per real model, in data, with role separate from model. The first scenario flies an O-1E, an A-1E and an F-100D, and RF-101C is defined for later scenarios. Spent long-endurance aircraft need recalling, so the automated players now do that.

### M7.8: Helicopters

Implements the helicopter rules in §8.5. The first scenario adds a UH-1B gunship, and AH-1G and OH-6A are defined for later. Landing, medevac, resupply and troop lift are deferred.

### M7.9: Weather

Implements §8.6 and the map layers in §9. The weather layer is a forecaster's chart, with storm tracks and a likely path, so a storm's approach can be planned for. Recon coverage age and terrain masking overlays were proposed and are still to do. Weather acts through one visibility figure in meters, set by rain strength and closeness to the cloud base, across ground observers, aircraft sensors, noticing, ground fire at aircraft and strikes. Valley fog is deferred, and so are weather effects on troop movement, flight safety and pilot behavior. One automated policy adjusts altitude to the forecast, and none routes or times missions around storms.

### M8: Squads (skipped for now)

Only if the M7.5 playtest shows that the extra detail is worth it. Subordinate elements with `parentId`, grouped map markers that keep spatial differences and hide unidentified capabilities, and commander-level covering fire and maneuver. Needs its own design pass first, including the deferred hierarchy in §2, radio responsibilities and batch run time, because detection cost grows with the square of the unit count.

### M9: Calibration

- Tune every policy into its acceptance band, then run sensitivity sweeps on the main constants to find fragile balance.
- Record the communication improvement in percentage points, against the target of about 10.
- Investigate whether ammunition, reinforcement and time limits can guarantee no no-air win.
- Playtest pacing at each speed, and check that real decisions arise often enough.
- Tune the §12 tempo targets alongside the win rates.
- Document known simplifications and final tuning values.

**Exit:** All §12 balance and tempo targets are met or deliberately revised, and §14 is satisfied.

### Next major step: theater operations

The planned direction after v0.1, not yet specified. A larger map covering a slice of a fictional, Afghanistan-like country in the Vietnam era, with several bases holding different aircraft. Today's aircraft models stay, with no drones or satellites. Sites zoom into today's 5 km grid. Play is continuous over days, without a win condition, and ops requests appear at random: SF reconnaissance, medevac, QRF, air support, troops in contact and search and rescue.

- **Vertical slice first:** Two sites, two bases, and only troops in contact and recon incidents, with mission-level autonomy. It tests whether juggling fights beats running one.
- **Then:** A theater layer owning time, bases and aircraft, sites created on demand, an incident generator, saving, and periodic reports instead of win conditions.
- **Longer spans:** Crews with duty limits and rotation, and weather generated as it goes rather than fixed at the start.
- **Night and flares:** Darkness feeds the visibility figure, and flare aircraft light an area for a few minutes at a time. Flares show the fight to both sides, and they have to be dropped under the cloud, so low cloud brings the flare aircraft into reach of ground fire.
- **Autonomy:** Orders become a mission with limits, such as an altitude floor, weather minimums and abort rules, and the crew flies it.
- **Detective work:** Requests are weighed against resources. Reports can overstate a situation, and how far a unit can be trusted is learned over time.
- **Calibration:** Requests served, response times and losses replace win rates. M9's fine tuning of the outpost should wait for this.

The features below become incident types in this structure.

### Roadmap after v0.1

Each feature needs its own spec section first, and the spec's deferred list still applies to v0.1. They're in build order, because the later ones depend on the earlier ones:

1. **Supply drop:** An aircraft drops ammunition to a ground unit, which ammunition tracking already supports. It needs no landing, so it comes first. The drop should be able to scatter or land near the enemy, with weather making that worse.
2. **Landing zones:** Helicopters land, stay on the ground under fire, and take off again. Everything below this point needs it, and it needs rules for choosing a landing zone and for a hot one.
3. **Medevac:** Lifting casualties out of a unit. Casualties are permanent today, so this needs a rule for what removing wounded gives the unit, such as morale.
4. **Troop transport and QRF:** Moving a quick reaction force by air to reinforce a position, or to block an attack. It needs a held reserve and a way to add a unit to the battle.
5. **Downed pilot and search and rescue:** Aircraft can be shot down, which reverses the current rule that a hit never destroys one. The crew survives on the ground, the enemy moves in, and the player has to protect a rescue aircraft with escorts.

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
| Tuning constants multiply and interact | All constants in config, sensitivity sweeps in M9 |
| Gentler morale lets the garrison hold without air | Re-run the no-air gate during M5, and restore pressure through enemy roles and attrition rather than a morale drain |
| Behavior choice flickers between updates | Minimum commitment time, a run metric counting behavior changes |
| Fewer TICs leave the player with too little to do | Tempo report, playtest at each speed |
| Per-weapon combat quietly changes the balance | Move constants across unchanged in M6, and compare tempo reports |
| One unlucky hit ends a sortie and decides a run | Damage forces RTB but never destroys; measure hits per run and tune team placement and hit chance |
| Equipment leaks into the player's view | `observedWeapons` starts empty and is set only by perception; extend the non-interference test |
| Abstract air outlives its purpose | Removal is an M3 task |
