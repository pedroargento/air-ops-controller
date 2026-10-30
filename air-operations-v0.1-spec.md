# Air Operations Controller — v0.1 Specification

**Status:** Draft for implementation  
**Version:** 0.1, revision 3 (design rules frozen for v0.1; numeric values are provisional until calibrated)  
**Platform:** Desktop browser, single player  
**Stack:** TypeScript (strict mode), Canvas 2D, HTML/CSS, Vite, Vitest  
**Visual target:** Functional grid, symbols, lines, labels; no illustrative assets required

## 1. Product definition

A real-time, pausable air-operations game in which the player acts as an **air operations radio controller**. Friendly and enemy ground formations fight autonomously under objectives and doctrine. The player cannot directly control ground movement or combat. The player receives reports from ground formations and higher command (CECON), maintains an imperfect operational picture, communicates selected information to friendly ground formations, and tasks a small number of aircraft.

**Core loop:** Receive report → interpret the operational picture → allocate aircraft → communicate with ground units → observe the results → adapt.

The ground war is not a scripted sequence of requests. Its outcomes arise from the ground simulation, modified by air intervention. The game's challenge is how and when to employ scarce aircraft, not whether the player can click the enemy quickly enough.

### 1.1 Core invariants

1. **Autonomous ground war:** Both sides use the same ground AI, communication and combat rules; objectives, doctrines, communication links, information and equipment can differ. No rule is conditioned on faction.
2. **No direct ground control:** The player can forward intelligence, acknowledge requests and ask for reports, but cannot order ground-unit movement or attack.
3. **Separation of truth and knowledge:** Ground AI acts on its own beliefs; the player's map uses only delivered reports and aircraft observations. No player-facing code may read hidden ground truth.
4. **Uncertainty is real:** Detection, position, estimated enemy strength and movement are imperfect. A reported coordinate is not a ground-truth coordinate.
5. **Reliable air telemetry:** The player always knows the position, mission, fuel, and ordnance of operational friendly aircraft. No routine aircraft communication failures in v0.1.
6. **Radio is an action:** Ground units schedule, delay, and sometimes interrupt reports as part of their autonomous activity. Radio reports cost simulated time.
7. **Air is indispensable:** The initial scenario is designed so its primary objective is unattainable by ground forces alone, but achievable with effective air tasking; it must not rely on a scripted enemy-invulnerability toggle.
8. **Deterministic replay:** Given scenario, seed, tick-stamped player commands, and version, the headless simulation must reproduce the same result on the same build and JavaScript engine.
9. **Controlled air dissemination:** The player automatically learns what friendly aircraft observe; ground formations learn it only when the player transmits it. Ground formations can also discover and exchange information independently over their configured links.

## 2. Scope and non-goals

### In scope for v0.1

- One fixed scenario on one rectangular terrain map; 100 × 100 cells at 50 m per cell (5 × 5 km).
- Three to five friendly and three to six enemy ground formations; platoon-sized formations are the primary unit, with smaller patrols represented identically where appropriate.
- One off-map airbase, one reconnaissance aircraft, and two close-air-support (CAS) aircraft.
- Ground AI: move toward objective, hold, observe, engage, become suppressed, and withdraw.
- Statistical combat; casualties, ammunition consumption and suppression.
- Ground/air cover and concealment on terrain cells; simplified line of sight (LOS) using elevation and terrain blocking.
- Imperfect ground observations: estimated contact position, approximate strength, type, activity and heading.
- Radio tasks, typed messages, report delays, player requests, outgoing intelligence reports and autonomous ground-to-ground communication over configured links.
- Aircraft: travel, orbit, reconnoiter, provide CAS, return to base; fuel and ordnance constraints.
- Player's knowledge map: marker aging, reported coordinates, estimated movement cones, and report history.
- Basic rectangular grid drawing, aircraft and unit symbols, clickable coordinates, aircraft order controls, pause and speed control.
- Headless scenario runs for balancing and debugging.

### Explicitly deferred

Helicopter rescue/medevac and troop transport; flare missions and illumination; crew assignment and fatigue; complicated tactical altitude/flight patterns and aggressiveness; multiple airbases and maintenance; weather and day/night mechanics; air-defense/aircraft loss modeling; realistic radio procedures, voice audio and interference; multi-echelon ground hierarchy; a persistent campaign; civilian simulation and rules of engagement; destructible terrain; advanced probabilistic tracking; complex enemy air operations; mistaken aircraft identification and friendly-fire damage; player-facing radio channels and channel contention; higher-command AI and dynamic CECON changes to ground objectives; report editing, player-authored enemy assessments and area-of-interest markers. These remain possible future features, not implicit v0.1 requirements.

## 3. Spatial model and time

- Coordinate system is continuous **world meters** (`Vec2`) with a grid providing terrain properties. All entities have true positions in the simulation.
- One fixed simulation step equals **one simulated second**. Player can pause or run at 1×, 2×, 4× or 8×. Rendering runs independently. Actions issued while paused are queued and take effect at the next tick.
- Ground movement, aircraft motion and radio-task progress update every second. Detection, ground tactical decisions and ground combat update every five simulated seconds; use fixed, documented ordering.
- A seeded random generator is owned by the simulation. Prefer stable per-subsystem/per-entity streams to prevent unrelated random draws from changing outcomes during tests.
- Each observation records its observation time. Each transmission records send and receive times separately. Receiving a stale report does not make its original observation fresh.

## 4. Ground formations and AI

A `GroundUnit` has identity, side, true position, personnel, ammunition, morale, suppression, posture, objective, doctrine/training, local belief state, and radio-task state.

**Objectives** are data, e.g. `HoldArea`, `MoveTo`, `PatrolArea`, or `WithdrawTo`. Each formation's standing objective and fallback position or area come from the scenario definition; no higher-command AI assigns them. **Doctrine** is a small set of behavioral parameters, not a faction-specific AI implementation.

The same decision function applies to both sides:

`decideGround(unitState, unitKnowledge, localTerrain, time) -> GroundIntent`

Initial behaviors:

- Move toward assigned objective using a simple terrain-aware route.
- Observe nearby terrain/contacts.
- Engage known enemies that are plausibly within reach and LOS.
- Seek available protection or become suppressed when incoming fire is intense.
- Withdraw toward the configured fallback when risk, casualties, suppression or morale cross configurable thresholds.
- Continue, defend, investigate or withdraw after significant events, using the doctrine-driven utility rules and limits in §4.2 and §4.3.

**No omniscience:** Decision logic receives a unit's estimates, not the truth about opposing units. The combat resolver may use true positions to determine physical outcomes; that truth must never be passed to decision or reporting logic as if it were perceived. Physical navigation uses true coordinates in v0.1; persistent navigation error (§5.1) affects reports only.

### 4.1 Statistical ground combat

For the MVP, calculate combat effects at the formation level, not per soldier or bullet. A unit's effective fire depends on current personnel, ammunition, range, terrain/cover, suppression, and its current target assessment. Resolve ammunition usage, suppression and casualties at each combat update. Combat remains seeded and stochastic, but all effects for an update are calculated from one shared snapshot and then applied together, so entity order cannot change the outcome.

The combat equations and tuning constants belong in scenario/configuration data. No separate damage rules for friendly and enemy factions.

### 4.2 Disengagement, recovery and return

- **Disengagement:** A formation withdraws toward its configured fallback when risk, morale or casualty thresholds are exceeded.
- **Recovery:** Suppression and some morale recover while disengaged. Casualties and expended ammunition do not recover.
- **Return:** Whether a withdrawn formation returns depends on its standing order, remaining resources and doctrine. Each return must be justified by current capability: a formation must not advance, lose personnel, recover morale and attack again indefinitely.

Formations do not perform company-level strategic planning in v0.1.

### 4.3 Responding to received information

A unit receiving intelligence re-evaluates its situation with doctrine-driven utility rules, choosing among a small set of responses. The player does not issue maneuver commands.

| Current objective | Incoming information | Potential response |
|---|---|---|
| Hold outpost | Enemy approaching | Adjust defensive posture or reposition within assigned area |
| Patrol sector | Enemy sighted nearby | Investigate, observe or avoid contact |
| Advance toward objective | Enemy on route | Continue, change route or delay |
| Withdraw | Enemy reported behind | Re-evaluate withdrawal route |
| Defend isolated position | Air support expected | Include expected support when evaluating whether it can continue holding |

Ground units react to authentic reported intelligence, even when the observation itself is inaccurate. Expected support comes only from actual aircraft assignments (§6.3).

## 5. Terrain, cover, concealment, and detection

Each terrain cell defines:

- Elevation (meters), terrain class, movement cost.
- Ground cover, air cover, ground concealment, air concealment (normalized values 0–1).
- Ground LOS and air LOS obstruction information (an MVP approximation is sufficient).

**Cover** reduces combat damage after an effective attack. **Concealment** reduces probability or quality of detection. They are separate and are evaluated independently for ground and airborne observers. Unit posture modifies effective concealment and protection.

Detection occurs before contact estimation. Merely having a hidden unit inside an aircraft's observable area must not reveal it. A simple stochastic detection probability may use distance, LOS, terrain concealment, target movement/firing, weather-neutral baseline, and observer quality.

An observation may reveal only part of a formation. The observer estimates enemy strength, rather than reading the true personnel count.

### 5.1 Position and strength estimation

- **Own position:** Maintain a persistent navigation estimate with slowly changing error. Do not resample an independent position error for every report by a stationary unit.
- **Contact position:** After detection, sample a position error around the true observed location; use a simple 2D Gaussian with dispersion adjusted for range, terrain, visibility, training and suppression. Repeating an unchanged observation reproduces its existing estimate.
- **Strength:** Draw an observed subset of the formation (e.g. binomial with observable fraction), then use a coarse, noisy inference to produce `Unknown` or a range/category (fireteam, squad, platoon, company, larger). Do not present observed headcount as exact true strength.
- **Motion:** When identifiable, report approximate heading and speed/activity (`moving`, `stationary`, `engaging`, `unknown`). These too may be incorrect or unavailable.
- **Contact identity:** Observer records do not automatically identify the underlying true `UnitId`. Contact IDs are locally generated report/track identifiers that reveal nothing about the underlying unit. The simulation keeps a private association between observer and true unit so that repeat detections update the same local track; that association never leaves simulation code.

Contact estimates persist until new information revises them; estimates do not randomly jitter on every render or simulation tick. New information means target movement beyond a configured threshold, a materially better observing position, or a changed activity.

### 5.2 Identification

Detection and identification are separate. A detected contact starts as `unidentified` and may become `friendly` or `hostile` through the observer's own sensors or through reports. Identification depends on the same factors as detection and can take time or fail.

In v0.1 an identification can be missing or delayed, but it is never wrong. Mistaken identification can be added later without changing the perception model.

## 6. Radio and command information

The player is the air operations radio operator. There are no separately simulated radio-operator staff, manual frequency controls or player-facing channels.

### 6.1 MVP message types

| Type | Typical source | Effect |
|---|---|---|
| `POSITION_REPORT` | Ground unit | Record/update reported friendly location |
| `CONTACT_REPORT` | Ground unit or aircraft | Record estimated contact |
| `TIC` | Ground unit | Flag urgent engagement and associated reported positions |
| `SITREP` | Ground unit | Report available status, casualties, ammunition, objective status |
| `SUPPORT_REQUEST` | Friendly ground unit | Create a pending support request; never auto-launch aircraft |
| `COMMAND_UPDATE` | CECON | Announce scenario-defined operational information and player priorities; does not change ground objectives in v0.1 |
| `ACKNOWLEDGEMENT` | Player to friendly ground | Close or temporarily suppress repeat requests; a `CAS inbound` acknowledgement also updates the unit's expected-support estimate (§6.3). Does not directly change morale |
| `INTEL_REPORT` | Player to selected friendly ground units | Add a forwarded, provenance-tagged observation to each recipient's belief state |

CECON in v0.1 is a simple scenario-driven command source, not a full simulated higher headquarters. Ground reporting and combat events are emergent rather than scripted.

### 6.1.1 Communication links

Each scenario defines communication links between formations, for both sides, without simulating frequencies, jamming or congestion. Units on either side use the same radio-task system to exchange messages autonomously with connected formations, and capabilities differ only through configuration.

Air operations is a node that links only to friendly formations and aircraft, so enemy messages can never reach `PlayerKnowledge`. The player receives only messages addressed to air operations and does not overhear ground-to-ground traffic. A unit may relay information it received; relayed information keeps its original source and observation time.

### 6.2 Radio tasks

Every ground formation, on either side, has a primary tactical activity **and** a concurrent radio task (idle, queued, preparing, transmitting, interrupted). The tactical activity continues while radio progresses.

- TIC, major contact, casualty/state changes, support needs, and scheduled position updates can create a report task.
- Reporting uses priority and delay; engagement modestly slows it, heavy suppression or an urgent withdrawal may delay or interrupt it.
- Failure to transmit now does not necessarily discard the report; retry/queue rules should be explicit.
- Capture the observation and original timestamp when detected, then allow the report to incorporate genuine newer observations before transmission.
- A player's `REQUEST_POSITION`, `REQUEST_SITREP` or `REQUEST_CONTACT_UPDATE` creates a high-priority task for the addressed ground unit, which answers from its own current knowledge, not with an immediate omniscient answer.
- Radio transport is reliable once the transmission completes in v0.1; no jamming, dropouts or encryption mechanics.
- Player transmissions take simulated time. There is no channel contention in v0.1.

### 6.3 Player radio interactions

A radio log shows timestamp, sender, type, natural-language template and structured fields. **Coordinates in messages are clickable and center the map on the reported point.** Aircraft tasking then happens through the normal map interface.

The player has three radio actions:

- **Forward a contact:** Select an existing contact, choose one or more friendly ground recipients, review the generated transmission preview, and transmit. Coordinates, force size, direction, confidence and provenance come directly from the stored observation, which is immutable. The player cannot edit it.
- **Request information:** Ask a known ground formation for a position report, SITREP or contact update.
- **Acknowledge a support request:** Send a plain acknowledgement, or `CAS inbound` when an aircraft is actually assigned.

Arbitrary map coordinates are used only for aircraft tasking. The player cannot invent an enemy contact in v0.1. Ground AI may act on a forwarded report but does not become player-controlled.

**Expected support:** The player never types or chooses an arrival time. `CAS inbound, ETA four minutes` is available only while a CAS aircraft has a `SupportArea` mission covering, or within a configured distance of, the recipient's last reported position. The ETA is calculated from that aircraft's mission. If the aircraft is diverted, delayed or returns to base, air operations automatically sends an update, which takes simulated time like any other transmission. An estimate that is never updated lapses after a configured grace period past its ETA.

## 7. Player knowledge and map projection

Maintain `WorldTruth` and `PlayerKnowledge` as separate states. Only a deliberately filtered `PlayerView` reaches UI code. The projection takes only `PlayerKnowledge`, aircraft telemetry and simulation time as input, never `WorldTruth`. A debug-only omniscient view is permitted but is clearly marked and cannot be activated by ordinary gameplay commands.

**Map updates:** All received aircraft observations update the operational map automatically. Ground reports update it only after successful delivery to air operations.

**Friendly ground location:** Use received position reports and aircraft observations that identify a friendly formation. Apply a simple deterministic evidence rule considering source accuracy and freshness. A newer self-report usually updates the marker unless a comparably recent, more reliable aircraft observation contradicts it; record the discrepancy instead of silently deleting a report.

**Contacts:** Store reported locations, strength ranges, heading, identification, source, confidence and age; avoid merging contradictory observations into ground truth. A new observation supersedes older ones within the same source track. Different sources are not automatically matched to each other, and unidentified contacts stay unidentified on the map.

**Unit loss:** There is no automatic notification that a ground formation was destroyed. Evidence comes from silence or from an observed loss.

### 7.1 Aging and reachability visualization

- Ground-unit/contact markers gradually fade with observation age down to a **25% opacity floor**, remaining selectable.
- The original reported point remains the observation anchor and displays its age and source.
- Stationary/unknown movement: growing circle around the last reported position.
- Direction of movement known: sector/cone originating at the reported position, oriented toward the reported heading, extending with plausible speed × elapsed time and widening as direction becomes stale.
- Known road movement may become a road corridor in a later version; v0.1 uses simple geometry.
- The cone represents a **possible region**, not a statistically calibrated probability contour. It never follows the hidden true unit trajectory.
- Aircraft positions, routes, mission states, fuel and ammunition are crisp and continuously updated for the player.
- Selected aircraft can show an approximate observation footprint; normal view hides all such footprints to reduce clutter. Terrain masking is computed without exposing hidden unit locations.

## 8. Aircraft simulation and orders

Aircraft have ID, type, true and player-visible position, base, speed, fuel, ammunition, mission, and sensor capability. Aircraft do not have independently simulated individual crew members yet. The airbase sits outside the map bounds, so aircraft positions can be off-map during transit.

Initial types: `ReconAircraft`, `CASAircraft`.

Player orders:

- `MoveTo(point)`
- `Orbit(point, radius)`
- `ReconArea(center, radius)`
- `SupportArea(center, radius)`
- `ReturnToBase`

Orders update missions; movement consumes simulated time and fuel. Aircraft can be retasked in flight, and aircraft launching from base incur a defined takeoff delay. Reconnaissance observes within a simplified footprint using air LOS and air concealment. Aircraft observations update the player's map automatically, but only new or materially changed contacts generate prominent radio messages. Ground formations receive aircraft observations only when the player transmits them.

### 8.1 CAS engagement

CAS has three stages:

1. **Search:** The aircraft attempts to acquire a target within its assigned area using its own sensors. Its cue can come from player orders, existing intelligence or reconnaissance reports. A good reconnaissance cue can shorten the search, but it never makes a target visible automatically. If a report is stale or inaccurate, the aircraft may find nothing.
2. **Identify:** Identification may remain unknown or take time, but a confirmed classification is never wrong in v0.1.
3. **Engage:** An aircraft can attack only a contact it has identified as hostile. Unidentified contacts are never attacked.

Attacks are discrete passes. Each successful pass consumes ammunition and causes probabilistic suppression and casualties, modified by air cover and weapon characteristics. Results flow through the shared ground-combat state rather than a scripted `support = success` flag. The player's click on a marker does not itself damage anything.

Contact position error and CAS search radius are tuned together, so that reconnaissance can make the difference between acquiring and missing a target.

The combat resolver prevents friendly-fire damage in v0.1. Aircraft report observed strike results automatically, never omniscient casualty counts.

### 8.2 Fuel, turnaround and aircraft presence

Aircraft return to base automatically before fuel runs out. Refueling/rearming uses simple fixed turnaround timers, configurable per aircraft type.

Enemy ground units react to aircraft through their own AI, and only if they detect the aircraft. There is no automatic suppression aura around an orbiting aircraft.

## 9. Player interface

Desktop-browser layout:

1. **Main Canvas map:** Grid terrain, simple elevation/terrain tint, aircraft icons and paths, ground unit reported markers, enemy contact estimates, uncertainty cones, TIC flags, selectable reported positions.
2. **Radio panel:** Chronological message log with type/source/time; clickable reported coordinates; structured responses, report requests and contact forwarding.
3. **Selected aircraft panel:** Current mission, fuel, ammunition, available orders and target/area selection.
4. **Global controls:** Pause, 1×/2×/4×/8× speed, current simulated time, objective and support-request list.

Interaction requirements:

- Click a radio coordinate → pan/center map on that **reported** coordinate.
- Select aircraft → choose mission → click point/area → aircraft starts tasking.
- Select friendly ground marker → see reports and permitted outgoing radio interactions; **no move/attack orders**.
- Select contact → see its details, choose recipients, review the transmission preview and transmit.
- Marker tooltip displays source, observation time, identification, confidence/strength category and whether the position is reported or aircraft-observed.
- Map never gives hidden enemy identities, true positions, or actual ground casualties that the player has not learned.

No textures, animation system, sound, contour rendering, weather layers, or elaborate HUD styling are required for v0.1.

## 10. Type-driven implementation architecture

Suggested tools: strict TypeScript, Vite, Canvas 2D, Vitest, JSON scenario definitions with runtime validation, and layered ASCII maps for terrain. Avoid a game framework and avoid a heavyweight ECS at this stage.

```text
air-operations/
  src/
    domain/         # immutable-ish data structs, tagged unions, IDs
    sim/            # pure rules, tick and explicitly seeded state changes
    perception/     # observation generation; may read truth
    knowledge/      # belief updates, PlayerKnowledge, PlayerView projection; must not read truth
    policies/       # automated players; PlayerView in, PlayerCommand out
    scenario/       # schema and initial-state loading
    ui/             # Canvas drawing, radio console, aircraft panels
    main.ts         # browser input, simulation clock, rendering
  scenarios/
    outpost-under-pressure.json
  tests/
    unit/
    integration/
    balance/
```

### 10.1 Required domain types

- `Vec2`, `SimTime`, `UnitId`, `AircraftId`, `ContactId`, `MessageId`
- `TerrainCell`, `TerrainGrid`
- `GroundUnit`, `GroundObjective`, `GroundPosture`, `Doctrine`, `UnitKnowledge`
- `Observation`, `Provenance`, `Identification`, `PositionEstimate`, `StrengthEstimate`, `ContactEstimate`
- `RadioTask`, `RadioMessage`, `RadioCommand`, `CommunicationLink`, `ExpectedSupport`
- `Aircraft`, `AircraftMission`, `AircraftOrder`
- `WorldTruth`, `PlayerKnowledge`, `PlayerView`, `Scenario`, `PlayerCommand`, `SimEvent`

Favor `Readonly` records, tagged/discriminated unions, exhaustive switches, explicit input/output types and a small set of pure functions. Mutable arrays and state may be used inside the simulation update for performance, but no implicit cross-module mutation or unseeded randomness.

### 10.2 Illustrative type contracts

```ts
type Vec2 = Readonly<{ x: number; y: number }>;
type PositionEstimate = Readonly<{
  center: Vec2;
  sigmaMeters: number;
  headingRad: number | null;
  speedMps: number | null;
  observedAt: number;
}>;
type StrengthEstimate =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'range'; min: number; max: number }>;
type Identification = 'unidentified' | 'friendly' | 'hostile';
type Provenance = Readonly<{ sourceId: string; observedAt: number }>;
type ContactEstimate = Readonly<{
  contactId: string;
  provenance: Provenance;
  identification: Identification;
  position: PositionEstimate;
  strength: StrengthEstimate;
  kind: 'infantry' | 'vehicle' | 'unknown';
  activity: 'moving' | 'engaging' | 'stationary' | 'unknown';
  confidence: 'low' | 'medium' | 'high';
}>;
type ExpectedSupport = Readonly<{
  aircraftId: string;
  etaAt: number;
  lapsesAt: number;
}>;
type RadioMessage =
  | Readonly<{ kind: 'TIC'; senderId: string; observedAt: number; sentAt: number;
      receivedAt: number; ownPosition: PositionEstimate; contact: ContactEstimate | null }>
  | Readonly<{ kind: 'CONTACT_REPORT'; senderId: string; observedAt: number;
      sentAt: number; receivedAt: number; contact: ContactEstimate }>
  | Readonly<{ kind: 'POSITION_REPORT'; senderId: string; observedAt: number;
      sentAt: number; receivedAt: number; position: PositionEstimate }>;
// Extend the union for the remaining message types described above.
```

The radio union is a sketch, not the complete schema; each final message type needs the same metadata conventions. Types do not replace runtime validation of scenario files.

### 10.3 Simulation tick pipeline

1. Every tick: accept player commands stamped for this tick; validate against the previous tick's **PlayerView** and current friendly-aircraft availability.
2. Every 5 ticks: generate ground and aircraft perceptions from a stable world snapshot using explicit RNG; update private ground beliefs and pending aircraft observations.
3. Every 5 ticks: select ground intents from beliefs/objectives; create or reprioritize radio tasks.
4. Every tick: resolve ground movement, aircraft movement and CAS search, identification and passes. Every 5 ticks: resolve ground combat from a shared snapshot through shared rules.
5. Every tick: advance radio tasks and deliver completed messages to ground recipients and air operations; update `PlayerKnowledge` from reports and aircraft observations.
6. Every tick: emit log/events; derive new `PlayerView` for rendering.

Define tie-breaking (entity ID order) so repeated runs are reproducible. Fork RNG streams by stable label. Do not let entity iteration order accidentally change visibility or combat outcomes.

### 10.4 Information boundaries

| Layer | Contents |
|---|---|
| World truth | All physical positions, strengths, objectives and combat states |
| Ground-unit knowledge | Local observations and received ground intelligence |
| Air observations | Reconnaissance contacts and aircraft sensor results |
| Communications | Autonomous ground-to-ground reports; automatic aircraft-to-player reporting; player-selected forwarding of observations to ground units |
| Player operational picture | Received observations with provenance, freshness, confidence and uncertainty |
| Player decisions | Aircraft tasking, information requests and forwarding of existing observations to selected recipients |

## 11. First scenario: Outpost Under Pressure

A fictionalized Vietnam-era map, inspired by the operational problems at Plei Me but **not claiming to reproduce the historical battle**.

- A friendly outpost must survive until the end of a fixed period (75 simulated minutes), while hostile formations pursue independent objectives to seize or isolate it.
- Friendly units have finite ammunition and limited strength; hostile numbers and objectives make unaided successful defense infeasible.
- One recon aircraft and two CAS aircraft begin available at the off-map base, with finite travel time, fuel, ammunition and turnaround times. Their timing and allocation should matter.
- At least two spatially separated threats should compete for the player's attention. Ground units generate TIC and contact reports according to their observations and radio readiness.
- Mobile formations, periodic reports and situations where reconnaissance is valuable are required, because scenario length alone does not create meaningful information uncertainty.
- **Capture:** The outpost is captured when the enemy has sufficient effective strength inside the objective area, friendly defenders are below a minimum effective strength, and both conditions persist for 60 seconds.
- **Success:** The outpost has not been captured at the deadline and a configured minimum of effective defenders remains. Failure and partial outcome statistics are still recorded even if the objective is lost.

| Provisional parameter | Value |
|---|---|
| Map | 5 × 5 km, 50 m cells (100 × 100 grid) |
| Duration | 75 simulated minutes |
| Aircraft transit | About 4–6 minutes, depending on type |
| CAS on-station endurance | About 10–15 minutes per sortie |
| Turnaround | About 10 minutes, configurable per aircraft type |
| Ground speed | Depends on formation, terrain and posture |

**No-air requirement:** The authored scenario must be tuned so there is no viable ground-only route to the primary win condition within its defined constraints. A headless test that finds 0 wins over many seeds is supporting empirical evidence, **not mathematical proof of a 0% probability**. Examine whether ammunition, reinforcement and time constraints can guarantee that outcome, rather than adding an artificial conditional that checks whether aircraft were used.

Successful air strategies must be materially more effective than indiscriminate or late air dispatch. Air support changes combat and observation, not an arbitrary victory score.

## 12. Testing and acceptance criteria

### Domain/unit tests

- Two opposing units use the same behavior/combat functions with different inputs and get symmetric rule treatment.
- A ground unit without a detection does not generate a contact estimate for a hidden opponent.
- Contact position/strength estimates remain unchanged until a genuinely new observation or estimation revision.
- A repeated position report carries the persistent navigation estimate, not a fresh independent error.
- Ground and airborne concealment affect detection; ground and air cover affect damage, separately.
- Radio task progress slows or pauses under suppression, while ordinary engaging need not stop reporting.
- Message contents never use true enemy coordinates or strength unless actually measured at sufficient accuracy.
- Marker opacity never drops below the configured floor; movement cones use only received observations and elapsed time.
- Clicking a radio coordinate navigates to the reported location, not the hidden true one.
- Non-interference: given identical `PlayerKnowledge`, aircraft telemetry and simulation time, projection produces identical `PlayerView` output regardless of hidden ground truth. This tests the projection boundary only; different battlefields can still generate different future observations.
- Radio, combat and decision code behave identically for both sides given identical inputs and configuration.
- An unidentified contact is never engaged by CAS, and the combat resolver applies no friendly-fire damage.
- A forwarded contact keeps the stored observation's contents, source, observation time and uncertainty.
- An incoming report changes a ground formation's selected tactical behavior in a deterministic test case.
- `CAS inbound` is unavailable without a qualifying aircraft assignment, its ETA comes from that mission, and an unfulfilled expected-support estimate lapses.

### Integration tests

- Opposing ground units independently encounter and fight; TIC emerges without a scripted event.
- TIC includes a plausible estimated friendly position and optional enemy contact.
- Report takes simulated time to arrive and automatically updates the operational picture when appropriate.
- Player sends aircraft to reported location; travel/fuel/munition rules apply.
- Recon can detect a contact missed by ground observers; a subsequent intelligence transmission affects a friendly commander's decisions.
- A CAS mission can help a ground formation but may fail when contact location is inaccurate or concealment prevents acquisition.
- A reconnaissance cue shortens CAS acquisition, while a stale cue can result in no target being found.
- Aircraft sightings reach ground formations only after a player transmission.
- Connected formations on either side exchange information autonomously, and no enemy message reaches `PlayerKnowledge`.
- Replaying the same seed and tick-stamped player-command log yields the same per-tick state hashes and events.

### Balance tests

Automated policies act only through `PlayerView` and `PlayerCommand`. Run each over at least 1,000 seeds. These are design targets, not measured results, and should be revised after the first simulation experiments.

| Policy | Initial acceptance target |
|---|---|
| No air intervention | 0 victories in 1,000 runs |
| Simple reactive CAS | 15–50% success |
| Reconnaissance-informed CAS | 55–85% success |
| Benefit of informed strategy | At least 20 percentage points above reactive CAS |

- 0 wins in 1,000 runs gives an approximate 95% upper confidence bound of 0.3% on the victory probability, assuming independent trials. It does not establish mathematical impossibility.
- Also run immediate CAS to first report as a diagnostic baseline. It has no acceptance band.
- **Value of communication:** Compare identical aircraft-tasking policies whose principal difference is whether reconnaissance intelligence is forwarded to ground units.
  - **Minimum acceptance:** The paired-seed 95% confidence interval for the outcome difference excludes zero.
  - **Design metric:** Record the improvement in percentage points, initially aiming for about 10. Statistical significance alone does not show that a player would notice the benefit.
  - If the two perform alike, ground AI isn't responding sufficiently to information.
- Track victory, duration held, friendly losses, sorties, unused ordnance, and response delays; do not reduce balancing to a single score.

## 13. Delivery milestones

| Milestone | Main deliverable | Key question |
|---|---|---|
| **M1: Ground simulation** | Autonomous ground combat, terrain, basic AI, debug Canvas, abstract air intervention | Can air meaningfully swing the battle? |
| **M2: Knowledge** | Detection, contact estimates, track aging, radio tasks, autonomous ground information exchange | Can units make decisions from incomplete information? |
| **M3: Air operations** | Aircraft motion, reconnaissance, CAS acquisition, fuel and ordnance | Do allocation and reconnaissance matter? |
| **M4: Player interface** | Operational map, radio log, contact forwarding, information requests, aircraft orders | Does the gameplay loop work end to end? |
| **M5: Calibration** | Reproducible policy testing, tuning, usability refinements, documentation of known simplifications and tuning values | Are the success-rate and information-value targets satisfied? |

Calibration starts in M1 and continues throughout development; M5 is final tuning, not the first check of whether the game is viable.

## 14. Definition of done

v0.1 is complete when a player can load the initial scenario, receive a self-reported TIC from an autonomous ground formation, click its imperfect reported coordinates, task an aircraft via the map, obtain better information from reconnaissance, optionally forward that information to selected friendly ground units, and measurably influence the autonomous battle. Fuel, ammunition and time constrain the decisions. The map shows uncertainty rather than hidden truth. A reproducible headless test suite demonstrates that the initial scenario needs effective air intervention and that choosing how to intervene matters.
