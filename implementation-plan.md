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
- **M8:** Replaced by S1. Squad detail didn't earn its cost in v0.1, but battle drills now need it.
- **M9:** Not started. Reduced to a playtest, with win-rate tuning moved to M13. See "Roadmap after v0.1" below.

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

Open items, most important first. Tuning waits for M13:

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

### M8: Squads (replaced)

Replaced by S1 in the roadmap below. Formations were enough for v0.1, but battle drills need squads to work with.

### M9: Playtest and close v0.1

Replaced the original calibration milestone. The theater work changes what needs tuning, so win-rate tuning, sensitivity sweeps and §12 tempo work on the outpost wait until they can be redone against the new measures.

- Play the outpost by hand at each speed and write down what is confusing, slow or dull.
- Fix usability problems that would carry over to the theater game.
- Record known simplifications and the current tuning values.

**Exit:** The outpost has been played by hand several times, and the findings are written down. The open items in Status stay open unless they still matter.

## 5. Roadmap after v0.1

The direction is a larger map covering a slice of a fictional, Afghanistan-like country in the Vietnam era, about 200 km across as a starting value. It has several bases with different aircraft, and sites that zoom into today's 5 km grid. Play is continuous, with no win condition, and ops requests appear at random. Today's aircraft models stay, with no drones or satellites.

Each milestone needs its own spec section before it starts. **Status:** S0, S1 and S4 are complete, and S2 is complete apart from the per-drill benefit.

Scenarios come first: they give playable missions sooner, test the ground AI on new maps, and become incident templates later, so each scenario's objective is written as an incident: a place, a time window, what it needs, and what happens if nobody comes. Timed orders are fine in a scenario, but each ground action is reusable, so an assault works the same for either side, in any scenario, however it was started. A scenario's stated objective is the mission only: threats and what to do about them are for the player to discover through recon. Numbers below are provisional.

### Scenarios

#### S0: Scenario framework

`npm run sim -- --scenario name` and `?scenario=name` in the browser. Objectives, end conditions and UI text come from the scenario instead of assuming the outpost, and terrain can be generated for a new map. Each scenario needs its own scripted policy to measure it.

**Exit:** The outpost's results don't change, and a second small scenario runs in the browser and in batch.

**Result:** Met. The outpost's 1,000-seed results are identical to the previous commit, its terrain regenerates byte for byte, and the replay hash is unchanged. Shared rules moved to `scenarios/rules/standard.json`. The second scenario, Valley Road, is an early version of S4's Convoy: over 200 seeds, scouting the route gets the column through 54% of the time, against 4% without recon. Forwarding makes it worse (60.5% without it), because warned units stop and run out of time, which is what S2's drills have to fix.

#### S1: Squads and platoons

Replaces M8. The squad becomes the smallest simulated combat unit, and a platoon is a command relationship between squads, so nothing physically splits. Companies wait for the theater. Zoom never changes the simulation.

- **Command:** Platoons hold the objective, assign squad tasks and react to reports. Squads move, observe, use cover, fight and report.
- **Radio:** Squads share information inside the platoon, and only platoons talk to Air Ops, so the player's radio doesn't grow with the unit count.
- **Morale:** A platoon has a shared morale effect, so squads don't drift away one at a time.
- **Strikes:** Heavy ordnance hits every squad in its blast radius. A pass that took a share of one large formation would otherwise lose most of its effect against a squad.
- **Performance:** The outpost goes from 11 units to about 39, so about 12 times as many detection pairs. Pairs out of range are skipped before any costly work.
- **Map symbols:** A pure view of `PlayerKnowledge`, built on today's consolidation. It distinguishes a visual cluster of contacts from a known formation. A cluster never claims an organization the player hasn't established, a platoon-sized report never produces invented squads, and zooming in never shows what hasn't been seen. Symbols for known units, formations and clusters look different.

**Exit:** The converted outpost keeps these relationships over 1,000 seeds: no-air stays near zero, informed beats reactive by at least 20 points, and forwarding still helps. A 1,000-seed batch across all policies takes no more than three times as long as today. A test confirms that map symbols never read truth.

**Result:** Met, except that no-air sits at 4.4% rather than S0's 0.3%. A scenario's `units` are now platoons, which divide into squads of about 12, and the outpost goes from 11 units to 33. Platoons keep their IDs for radio, orders and the player's view, so squads are invisible outside the sim except as separate aircraft sightings, which the map rings as clusters. Over 1,000 seeds: none 4.4%, reactive 52.7%, immediate 38.4%, informed 73.7%, without forwarding 57.4%, so informed leads reactive by 21 points and forwarding adds 16. Batch time is 2.8 times S0. Reactive is just above the spec's 15–50% band. Small-arms and machine-gun fire went up (suppression 1.3 times, damage 1.15 times) because attackers lost force when divided, and strikes gained `strikeSplashMeters`. The outpost's strikes are weaker per pass, so Valley Road's ambushes moved to tighter positions: 33% through with recon, 1% without. Forwarding now changes nothing there, because an air report describes one squad and a warned platoon no longer reacts. S2 has to fix this.

#### S2: Ground orders and battle drills

- **Assault:** A reusable drill on any area, for either side, which ends when the platoon's own picture shows the area clear. How it approaches, fights and breaks off comes from doctrine, not the scenario.
- **Triggers:** A platoon's next objective can start at a time, when its current objective ends, or when a contact is reported. Today's objective schedule becomes the time case.
- **Reaction forces:** A reserve holds until a linked unit reports contact, then goes to the reported location. It acts on the report rather than the truth, so a late or wrong report sends it late or to the wrong place. Both sides use the same rule.
- **Drill format:** A drill is data: a trigger read from the platoon's own picture, squad roles, phases and an end condition. Rules follow published small-unit drills, such as the battle drills in FM 7-8, and doctrine sets the parameters per side.
- **First drills:**
    - **React to near ambush:** Fired on from inside a doctrine distance, the squads in the kill zone assault through at once, since staying or running is worse.
    - **React to far ambush:** Fired on from beyond that distance, squads take cover and return fire, then an uncommitted squad flanks or the platoon breaks contact.
    - **Deliberate attack:** A known enemy position on the route gets a platoon decision to bypass, attack or wait, from estimated strength, time left and expected support. An attack leaves one squad in support by fire while others approach by a covered route.
    - **Bypass:** Reroutes around a reported enemy.
    - **Hasty ambush:** Takes a covered position when warned of an approaching enemy and holds fire until close.
    - **Support by fire:** One squad pins while others assault.
- **Concealed ambush:** A new hidden posture, with no fire and no movement, so an ambusher can stay unseen until close. Today's best posture only conceals 0.3, which probably isn't enough for an ambush to survive a column's approach. Measure this first, since the near ambush depends on it.
- **Knowledge decides the drill:** The same ambush plays differently depending on what the column knows, which is how a forwarded report pays off. Near and far ambush are what happens without a warning, and deliberate attack, bypass and hasty ambush are what a warning allows.
- **Visibility:** Each drill sends a radio message, so the player can see a forwarded report change what a unit does.
- **Later drills, as scenarios need them:** Standalone flank and break contact, as well as requesting air for a deliberate attack.

**Exit:** The same assault runs unchanged on two maps and for both sides, a QRF responds through reports alone, a misplaced report misdirects it, each drill shows a measured benefit in batch runs, and on Valley Road forwarding beats not forwarding.

**Result:** Partly met. The same assault runs on two maps for both sides, a QRF acts on reports alone, a wrong report misdirects it, and forwarding now helps on Valley Road: over 1,000 seeds, 74.1% against 65.8% with CAS and 33.0% against 20.0% with scouting alone, with none at 25.2% and reactive at 24.4%. The per-drill exit is not met. Forgetting each drill over 500 seeds shows attack worth 21 points without air and 13 with it, and near ambush 5 and 4. Bypass, hasty ambush and wait for air show nothing on this map, and far ambush makes things worse by 4 to 6 points. `npx tsx src/cli/batch.ts --without-drill <name>` repeats the measurement. The outpost's attackers keep `assault`, which has no drills, so its balance holds: none 7.6%, reactive 54.2%, informed 76.1%, without forwarding 59.5%. Valley Road grew to 2 hours, with 24-man ambushes beside the road and a new `column` doctrine. Three additions came out of testing: a sprung ambush is 12 times as deadly for 45 seconds to a platoon nobody warned, a report helps a unit spot what's hidden near it, and a platoon on the move rallies nearby rather than marching back to its start. Drills run only for platoons with `MoveTo` or `AssaultArea`, so patrols and holding units are unchanged.

#### S3: Aircraft weapons

Armed aircraft carry two weapon classes, each with its own ammunition, replacing today's single blended pass. Unarmed scouts stay unarmed.

- **Guns:** Many bursts, mostly suppression, one squad at a time. They need a good position and a low pass.
- **Heavy ordnance:** Bombs, rockets and napalm. Few passes, mostly casualties, area effect, tolerant of a rough position, and usable from higher up.
- **Helicopter door guns:** Can fire around a landing helicopter, for use from S7.

**Exit:** The two classes suit different situations in batch runs, and an aircraft out of heavy ordnance stays useful at a real cost in exposure.

**Crew autonomy (started):** Crews now decide how to fly their missions (§8.0), from their own picture. They choose altitude, react to ground fire within a risk limit the controller sets, fly attack runs, use heavy ordnance first and guns where friends are too close for it or once it's gone, and search a recon area until they find something. The bots now only assign missions; the altitude, cloud and threat logic they used to carry moved into the crews, and they send aircraft home to rearm once the bombs are gone. Over 1,000 seeds, the outpost is none 3.3%, reactive 29.8%, immediate 29.3%, informed 68.5% and without forwarding 52.0%, which matches the 68–71% of the old bots that managed altitude by hand. Lingering on guns instead of rearming drops informed to 55.9% and raises hits from 0.63 to 0.77 per run. Cautious crews reach 53.3% with 0.48 hits, and press-on crews 69.2% with 0.77. Valley Road is none 19.6%, reactive 15.6%, recon and CAS 78.8% forwarded, 50.7% without and 79.7% with marks, and scouting only 68.7%, 18.2% and 68.7%. Find Them is 0%, 0% and 81.5%. Guns don't yet show a clear benefit: rearming early does as well as having them, so S3's exit is not met.

**Weapons orders and suppression:** A support order now says Bombs, Guns or Both. Under Guns a crew paces its bursts over its time on station, and gun bursts cover 60 m. A support request names the weapons a unit wants and, when it knows one, a target. Units ask for guns when moving or with the enemy close. The wait-for-air and push-through drills exist, but the column doctrine doesn't use them, because they lost over 400 seeds: Valley Road with CAS 76% with them against 79% without, reactive 12% against 19%, and scouting only 67% against 70%. Suppression fades with a half-life of about 40 seconds, so paced bursts don't hold a position down, and even fast bursts didn't change the result. Over 1,000 seeds, the outpost is now none 3.3%, reactive 19.1%, immediate 29.2%, informed 69.3%, without forwarding 51.4%, lingering on guns 60.4%, cautious 52.7% and press on 69.4%. The reactive drop from 29.8% comes from giving units the guns they ask for. Valley Road is none 19.6%, reactive 16.0%, recon and CAS 78.5% forwarded, 49.1% without and 79.3% with marks, and scouting only 68.7% forwarded and 18.2% without. Find Them is 0%, 0% and 81.5%. Guns still show no situation where they win, so S3's exit is still not met.

**Stronger suppression (tried, not adopted):** Every rules value now has a description, collected in `docs/parameters.md` (generated with `npm run params`), and the batch runner takes `--set path=value` to try a value without editing files. Using that, over 300 seeds each: slowing suppression's fade from 8% to 2.5% every 5 seconds narrows the gap between lingering on guns and rearming (55.7% against 56.3% at the outpost), but it pins defenders as much as attackers, so outpost informed falls from 69.3% to 56.3%. Gun runs strong enough to pin a squad at once barely change anything. Holding for air on Valley Road loses in every form tried, whether asking for guns or for both, then pushing through or attacking: reactive 11–14% against 21–23% without it. The cause isn't found yet. The defaults are unchanged.

**Aircraft tasks and fire missions:** Move to, Orbit, Recon area and Support area differed only in whether recon searched and whether a strike aircraft could fire. They are now one **Watch** task plus **weapons control** set per aircraft (Hold, Bombs, Guns, Both). Over 100 seeds every existing policy on all three maps gave identical results, so the merge changed no battles. Three tasks are new. **Cover** follows a friendly platoon on the controller's map and watches ahead of it. **Suppress** puts gun runs on a place until a time, with no target needed: bursts last the window, fire is walked across the area away from friendly platoons, and friends are kept out of a gun pass's whole reach. Air operations announces each suppression to every platoon it can reach, and a platoon pushes through a position it was told is being suppressed. **Strike** is one heavy pass on a place. Suppress and Strike are in the map's right-click menu, and Cover is in a platoon's panel.

What they're worth, over 300 seeds on Valley Road: suppressing marked ambushes as the column nears them loses 4.3 points against marks alone (paired, −7.8 to −0.8), answering requests with suppression gives 15.7% against reactive's 20.7% (Outpost 6% against 20%), and covering the lead platoon gives 81.7% against 79.0% for sending CAS at sightings (paired +2.7, −2.5 to +7.8). Traces show why suppression loses here. The aircraft is taken off bombing to do it, and Valley Road's ambushes sit 70–150 m from the road, so once the column is close the crew has to hold or risk hitting it. Before the friendly margin was added, gun runs walked onto the column and broke its morale, and it withdrew. Guns still show no situation where they win, so S3's exit is still not met. A suppression mission should matter where the enemy is set back from friends and bombs are gone or too risky, which no current map has.

**Map conventions:** The map now borrows from real military maps. Units are APP-6-style symbols: frames by side with suspect and unknown, icons, size marks, (−) and an operational-condition bar from claimed losses, solid and dashed ✕ for destroyed and probably destroyed, movement arrows and last-seen times. The terrain is a 1:50,000-style sheet: land cover in color, relief as light hillshading with 20 m contours and labeled 100 m index contours, spot heights, roads and streams as smooth lines, and a labeled 1 km grid. Selecting an aircraft shows maximum elevation figures, red where the ground is above its altitude. Aircraft carry data blocks with brevity words, contact reports read in SALUTE order, and contacts carry an Admiralty rating. The uncertainty circles and cones are gone: a contact not seen for two minutes gets a dashed frame and its last-seen time at its last known position, keeps its movement arrow, and where it went is the player's call. Display only: no battle changed. The condition bar fills only from aircraft strike claims until ground units report what they inflict, which is the next step together with tracks.

**Tracks, claims and source ratings:** Air operations now keeps tracks (§7.2). Each report is matched once against the live tracks through a gate: three times the combined position error plus plausible movement, side, size within a factor of two, and no second contact from the same source. The map shows one fused marker per track, numbered from TN 4001, with each part taken from the best source. The first gate was the old strict test, which gave 1.7 tracks per enemy squad, because independent errors from two crews often fall outside the sum of their sigmas and neighbouring size bands never overlap. With the gate, fresh tracks never outnumber the true squads, and the extras are stale last-known positions, drawn dashed. Ground units now claim the men they see fall near where they're firing, at 1.4 times with noise. The map deconflicts claims per track: each source once at its highest, the largest ground claim rather than the sum, plus aircrew assessments. Per track the condition is about right: across four outpost runs, 15–19 tracks showed combat-ineffective or probably destroyed, against 16–20 squads that really were. The bar uses NATO's thresholds: neutralized at a tenth, combat-ineffective at three tenths. The debrief sets claims against the truth and rates each source A to E from its real error and wrong-side reports. In a sample outpost run, four platoons claimed 172 against 64 really lost, about one each per platoon. Over 300 seeds, with bots reading tracks: outpost informed 71.7%, without forwarding 49.3%, reactive 20.0%, lingering 68.7%, cautious 46.3%, press on 65.3%; Valley Road recon and CAS 78.0%, without forwarding 43.3%, with marks 77.0%, scouting only 69.0%, cover 81.3%. Lingering rose and cautious and Valley Road without forwarding fell by more than noise; the rest is within it.

**Crew calls, 9-line requests and smoke:** Crews call JOKER, BINGO, bombs expended and WINCHESTER once each per sortie. Support requests carry the target, its size, the mark and the friendlies' position, and a platoon expecting air throws smoke on the hostile it knows of nearest it, which helps crews find and identify targets near it and warns the enemy. The reactive bot now centers on the requesting platoon, not the named target. Over 300 seeds none of this changes the bots' results: outpost informed 69.0%, reactive 21.7%, Valley Road recon and CAS 77.3%, with marks 77.3%, all within noise of the track results. Smoke is a tool for the human controller more than for bots that already know where to look.

**Overwatch (S3's guns test):** A new scenario, Overwatch, puts three 22-man positions with two machine guns each 230–280 m off the Valley Road, an air defense team behind them, and CAS-1 with two bombs. Scenarios can now give an aircraft its own bomb load. It spreads the bots well: none 10%, reactive 13%, recon and CAS 20%, with marks 24%. Guns still don't matter: over 300 seeds paired, suppressing the positions as the column nears them gives +0.3 points against marks alone (−4.0 to +4.6), lingering on guns +0.7 (−3.8 to +5.1), and suppression against lingering −0.3 (−5.8 to +5.1). This was the map most in favour of guns: enemy outside danger close, bombs scarce. So S3's exit isn't met, and the measured answer is that guns are a fallback for when bombs are gone, not a weapon that changes outcomes.

**Air status board:** The Summary tab ends with each aircraft's next hour from its telemetry: en route, on station, returning, rearming, ready.

**Track fusion and merging, and the key:** A track's position is now the precision-weighted average of its comparable reports, and every five seconds tracks that turn out to be one group are merged, with a stale track folded into a fresh one only when exactly one could be its unit. Merging is cautious and changes little: across five outpost runs the hostile tracks late in the fight fell from about 32 to 30 for 25 squads, because most stale tracks sit near several squads and are left as last known positions. The map key is now a full panel that draws every symbol with the map's own code and explains the radio words, task codes and report conventions.

**Controls overhaul:** Support requests are cards with one-click answers: "Send CAS-1 · ETA", which tasks the aircraft over the unit and promises it together, the reason any other aircraft can't go, and "No air available". A status line follows the answer through inbound, on station and called off; air operations now records each answer, so the card can say what came of it. Danger close shows "cleared until" with Revoke, and a "DC until" mark on the unit; denying a clearance already given now revokes it. Every action the controller sends is written into the radio log and shown briefly. The aircraft panel leads with what it's doing, shows a task's settings only once it's picked, keeps standing settings apart, and explains each button on hover; a banner says what a map click is for. Right-click offers what fits where it lands, and keyboard shortcuts cover selecting aircraft, tasks, pause and cancel. No battle changed.

**Time, tracks and the timeline:** Times are military time from each scenario's start (0545 at the outpost), with the time left in the header. A Tracks tab lists every track, sortable by threat, newest or least damaged, and a row selects and centers it. The timeline opens during the run or after it, pauses the battle, and shows the map as the controller knew it at any earlier moment, with the radio's key messages marked along it. After the run it can also show where every squad really was. The selection and request panels now scroll on their own, so the bottom tabs always keep room. The threats overlay is gone; selecting an air defense contact still shows its ring. No battle changed.

#### S4: Find them, and Convoy

**Find them** is recon only: locate an infiltrating force and be scored on how close the picture was to the truth. **Convoy** has a column moving through a valley, with the player scouting for ambushes and covering it when hit.

**Ambush recognition** arrives with Convoy. The sim never labels anything an ambush. Crews report only what they can see: stationary squads, their weapons, and which way they face, which is a new observation. The player reads the pattern and marks a suspected kill zone, which is forwarded as an area with a new command. It enters the platoon's picture as a low-confidence enemy position, so it can trigger a bypass or deliberate attack. A wrong mark costs real time, and an ambush the player missed still gets sprung. This brings in the player-authored assessments and area markers that v0.1 ruled out.

**Exit:** In both, better recon gives measurably better results.

**After the code review, the truth pass and danger close:** These figures replace the ones in the results above and in S1 and S2. Deciding uses only estimates and resolving uses truth (§10.4): ground fire goes at a point and hits whoever is near it, and crews commit strikes on their estimate. Strikes now hit friends too, crews hold off friendly markers unless the controller clears a unit's danger close request (§8.1.1), and the bots deny by default. Over 1,000 seeds, the outpost is none 3.3%, reactive 29.8%, immediate 30.7%, informed 61.2% and without forwarding 52.6%; approving every request drops reactive to 8.5% and informed to 54.6%. Valley Road is none 19.6% and reactive 17.3%; scouting only is 17.2% unforwarded, 61.0% forwarded and 70.0% with marks; with CAS it's 53.5%, 83.2% and 85.4%. The drill and wrong-mark measurements were taken just before danger close: attack worth 18 points without air and 24 with it, far ambush 7 and 6, near ambush, hasty ambush and wait for air nothing, and bypass costing 4. Two marks on empty road cost about 250 seconds and 1.5 points, within noise.

**Result:** Met. Over 1,000 seeds, Find Them scores 0% with no aircraft, 0% with one fixed orbit and 81.6% with a planned sweep. Valley Road, which is Convoy for now, gets through 27.5% of the time with no air and 26.4% with reactive CAS. With scouting only it's 23.3% unforwarded, 38.0% forwarded and 44.4% with kill-zone marks, and with CAS it's 67.2%, 77.1% and 80.8%. The kill zone is the first kind of a generic point of interest: right-click the map, choose recipients and report, and a new kind is one entry in `POI_KINDS`. Crews now sometimes see which way a still squad faces, drawn as a short line, and nothing labels an ambush. Limiting wide flanks to platoons of three or more squads stopped far ambush hurting, so it's now neutral rather than useful. The marking bot needs two squads seen facing the same ground. A wrong mark isn't a real risk yet: two marks on empty road cost about 80 seconds and no measurable success (81.0% against 76.8%, over 400 seeds), because the 2-hour limit leaves plenty of slack.

#### S5: Compound support

A team already on the move on foot assaults a compound, starting on a timed order. The player's only stated objective is to support the team. The briefing doesn't mention a QRF or anything else in the area: the player finds out by scouting, then decides what to do about it.

Recon's value should show in two ways. Air can attack what it finds, and forwarded reports change what the team does, because they enter the platoon's picture and it can bypass, set an ambush or brace. The player still gives ground units no orders. The scenario scores the team's result, with nothing awarded for stopping the QRF as such. Nothing lands.

**Exit:** Scouting policies beat one that only answers requests, forwarding beats the same recon without it, and fights play out differently across seeds. Policies find the QRF through recon, never from the truth.

#### S6: Supply drop, and Besieged outpost

An aircraft drops ammunition to a ground unit. The drop can scatter or land near the enemy, and weather makes that worse. In the scenario, a low outpost has to be resupplied before a storm closes in.

**Exit:** A well-timed drop changes the result, and a bad one can feed the enemy.

#### S7: Wounded and medevac

- **Casualties:** They divide into killed and wounded by a set share. Wounded leave the fight but stay with the unit, and some die as time passes.
- **Landing:** Helicopters land, sit exposed on the ground and take off. Includes hot landing zones and limits on load at high altitude.
- **Loading:** Casualties are numbers, not individuals. They load at a rate per minute on the ground, slowed by fire, up to the aircraft's capacity, so each extra minute saves more people and risks the aircraft.
- **Results:** Killed, died of wounds, evacuated and time to hospital appear in the debrief. Medevac is added to Compound support.

**Exit:** Faster medevac measurably reduces deaths, and time on the ground has a real cost.

#### S8: Downed crew

The crew starts on the ground, so no shoot-down rule is needed. They evade while the enemy closes in and may set a flak trap, and the player protects a rescue aircraft with escorts.

**Exit:** Escorts and timing change the result, and rushing in can lose the rescue aircraft.

Further scenario ideas: Hunt the flak, Last lift, and Last light once night exists.

### Phase 1: Prove the idea

#### M10: Mission orders

Orders become a mission with limits, such as an altitude floor, weather minimums, a fuel limit and abort rules, and the crew flies it and reports back. Pilots can refuse or break off within those limits. The player can still take direct control. Built on the outpost, so it can be measured against today's game.

**Exit:** An automated policy using only mission orders matches today's direct-control results within 5 points of wins. By hand, the outpost can be run without flying aircraft directly.

#### M11: Sites and theater state

A theater layer owns the clock, bases and aircraft, and each site owns its map, units, weather and player picture. Aircraft travel between sites in transit. No gameplay changes: a one-site theater is the outpost.

**Exit:** A one-site theater gives statistically the same results as the outpost over 1,000 seeds, and replay still matches.

#### M12: Two-site slice

Two hand-made sites and two bases, with scripted troops in contact and recon incidents. The UI adds a site switcher and a radio filtered by site. No other new mechanics.

**Exit, and the decision point for everything below:** By hand, is juggling two fights better than running one? If not, stop and rethink before building Phase 2.

### Phase 2: Continuous play

#### M13: Incidents and shifts

An incident is data: a place, a time window, what it needs, and what happens if nobody comes. A generator creates them at a set rate, and they replace win conditions. A shift ends in a report card, with damage and aircraft availability carrying over. Calibration moves to requests served, response times and losses, with arrival rate as the main dial. The outpost's fine tuning restarts here, against these measures.

**Exit:** An automated policy can run an 8-hour shift, and arrival rate moves service levels predictably. By hand, a shift has quiet stretches and real overload.

#### M14: Reports that can mislead

Units can overstate strength and urgency when under pressure, so a request has to be weighed before aircraft are committed. Checking one costs a recon aircraft and time.

**Exit:** A policy that verifies doubtful requests beats one that believes them all, and one that ignores them.

#### M15: Saving and long sessions

Save and load, snapshots so that replay doesn't grow without limit, and a clock that runs fast through quiet periods and slows when something needs the player.

**Exit:** A multi-day run can be saved, reloaded and continued to the same final hash.

### Phase 3: The region

#### M16: Regional map and generated sites

The 200 km map built from a slice of real elevation data, with invented place names, and sites created on demand from it. The ground AI has to give good fights on any terrain, which this milestone must test. Terrain masking gets the valleys it needs. The theater map zooms into sites.

**Exit:** Over a sample of generated sites, fights fall inside tempo targets as often as the outpost does, and air's value holds up.

#### M17: Bases and theater weather

Several bases with different aircraft, so which base answers a call becomes a decision. Weather is generated as time passes rather than fixed at the start, with a regional forecast chart of larger storm systems above each site's chart.

**Exit:** A policy that chooses bases by distance, aircraft type and weather beats one that always uses the nearest base.

### Phase 4: Airlift

#### M18: Troop transport and QRF

A held reserve moved by air to reinforce a position or block an attack, and inserting and recovering teams. Uses landing from S7 and reaction forces from S2.

**Exit:** An airlifted QRF changes results in shift runs, and using one leaves a real gap elsewhere.

### Phase 5: The long war

#### M19: Crews and rotation

Crews with duty limits, rest and fatigue, assigned to aircraft. Fatigue feeds into sensor quality and strike accuracy, and experience into how well crews use their autonomy. Repairs and aircraft availability become longer-term problems.

**Exit:** Spending all crews early leaves a measurable gap later, so a policy that holds some back does better over several days.

#### M20: Unit reputation

Units build a track record, so the player learns who overstates. Needs the long spans from this phase and the reports from M14.

**Exit:** A policy that uses each unit's history beats one that treats all units the same.

#### M21: Day, night and flares

A day cycle feeding the visibility figure, only some aircraft types working at night, and attacks favoring darkness. Flare aircraft light an area for a few minutes at a time. Flares show the fight to both sides, and they have to be dropped under the cloud, so low cloud brings the flare aircraft into reach of ground fire.

**Exit:** Night shifts play differently from day shifts, and flares change the outcome of night fights.

### Candidates, not scheduled

- **Shooting down aircraft:** Aircraft can be lost in any scenario, reversing the rule that a hit never destroys one, which makes search and rescue an incident type.
- **Danger close:** Strikes near friendly troops carry a risk the player chooses to accept. Lifts the ban on friendly-fire damage.
- **Artillery and check fire:** Friendly guns have to stop while aircraft cross their fire path.
- **Forward air controllers:** Recon marks targets for more accurate strikes, at the cost of staying exposed.
- **Flak suppression:** A dedicated role against air defense, reusable for rescue escorts.
- **Weather on the ground:** Effects on troop movement, and valley fog.

## 6. Testing

| Layer | When it runs | Contents |
|---|---|---|
| Unit | `npm run check` | §12 domain tests |
| Integration | `npm run check` | §12 integration tests, golden replay hash |
| Quick balance | `npm run check` | About 50 seeds per policy, to catch breakage rather than judge balance |
| Full balance | `npm run balance` | 1,000+ seeds per policy, with a saved report |

Golden replay hashes change whenever rules or tuning change, so a hash update must be a deliberate part of the change that caused it.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Air can't swing the battle while no-air stays at 0 wins | M1 go/no-go gate |
| Real perception undoes M1's balance | Re-run the gate at the end of M2 |
| Ground AI ignores information, so forwarding is pointless | M2 deterministic test, M3 forwarding comparison |
| Ground AI loops between advancing and retreating | Debug canvas, §4.2 return rule, a run metric counting repeat withdrawals |
| Truth leaks into player-facing code | Import rules, non-interference test, policies limited to `PlayerView` |
| Tuning constants multiply and interact | All constants in config, sensitivity sweeps in M13 |
| Gentler morale lets the garrison hold without air | Re-run the no-air gate during M5, and restore pressure through enemy roles and attrition rather than a morale drain |
| Behavior choice flickers between updates | Minimum commitment time, a run metric counting behavior changes |
| Fewer TICs leave the player with too little to do | Tempo report, playtest at each speed |
| Per-weapon combat quietly changes the balance | Move constants across unchanged in M6, and compare tempo reports |
| One unlucky hit ends a sortie and decides a run | Damage forces RTB but never destroys; measure hits per run and tune team placement and hit chance |
| Equipment leaks into the player's view | `observedWeapons` starts empty and is set only by perception; extend the non-interference test |
| Abstract air outlives its purpose | Removal is an M3 task |
