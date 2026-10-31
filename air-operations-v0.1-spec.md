# Air Operations Controller — v0.1 Specification

**Status:** Draft for implementation  
**Version:** 0.1, revision 10 (design rules frozen for v0.1; numeric values are provisional until calibrated)  
**Platform:** Desktop browser, single player  
**Stack:** TypeScript (strict mode), Canvas 2D, HTML/CSS, Vite, Vitest  
**Visual target:** Functional grid, symbols, lines, labels; no illustrative assets required

## 1. Product definition

A real-time, pausable air-operations game in which the player acts as an **air operations radio controller**. Friendly and enemy ground formations fight autonomously under objectives and doctrine. The player cannot directly control ground movement or combat. The player receives reports from ground formations and higher command (CECON), maintains an imperfect operational picture, communicates selected information to friendly ground formations, and tasks a small number of aircraft.

**Core loop:** Receive report → interpret the operational picture → allocate aircraft → communicate with ground units → observe the results → adapt.

The ground war is not a scripted sequence of requests. Its outcomes arise from the ground simulation, modified by air intervention. The game's challenge is how and when to employ scarce aircraft, not whether the player can click the enemy quickly enough.

### 1.1 Core invariants

1. **Autonomous ground war:** Both sides use the same ground AI, communication and combat rules; objectives, doctrines, communication links, information and equipment can differ. No rule is conditioned on faction. A unit's capabilities come from its equipment and personnel, never from a hardcoded unit class.
2. **No direct ground control:** The player can forward intelligence, acknowledge requests and ask for reports, but cannot order ground-unit movement or attack.
3. **Separation of truth and knowledge:** Ground AI acts on its own beliefs; the player's map uses only delivered reports and aircraft observations. No player-facing code may read hidden ground truth.
4. **Uncertainty is real:** Detection, position, estimated enemy strength and movement are imperfect. A reported coordinate is not a ground-truth coordinate.
5. **Reliable air telemetry:** The player always knows the position, altitude, mission, fuel, ordnance and damage state of operational friendly aircraft. No routine aircraft communication failures in v0.1.
6. **Radio is an action:** Ground units schedule, delay, and sometimes interrupt reports as part of their autonomous activity. Radio reports cost simulated time.
7. **Air is indispensable:** The initial scenario is designed so its primary objective is unattainable by ground forces alone, but achievable with effective air tasking; it must not rely on a scripted enemy-invulnerability toggle.
8. **Deterministic replay:** Given scenario, seed, tick-stamped player commands, and version, the headless simulation must reproduce the same result on the same build and JavaScript engine.
9. **Controlled air dissemination:** The player automatically learns what friendly aircraft observe; ground formations learn it only when the player transmits it. Ground formations can also discover and exchange information independently over their configured links.

## 2. Scope and non-goals

### In scope for v0.1

- One fixed scenario on one rectangular terrain map; 100 × 100 cells at 50 m per cell (5 × 5 km).
- Three to five friendly and three to seven enemy ground formations; platoon-sized formations are the primary unit, with smaller patrols represented identically where appropriate.
- One off-map airbase, one reconnaissance aircraft, two close-air-support (CAS) aircraft and one helicopter gunship, drawn from real Vietnam-era models.
- Ground AI: move toward objective, hold, and choose among observe, probe, harass, assault and disengage behaviors.
- Statistical combat; casualties, ammunition consumption, suppression and morale as separate tracks.
- Equipment: small arms, machine guns and anti-aircraft weapons, with combat capabilities derived from each unit's inventory.
- Player-controlled aircraft altitude, trading safety from ground fire against sensor and strike effectiveness.
- Ground fire against aircraft, with risk tied to altitude; a hit damages the aircraft and forces it back to base.
- Ground/air cover and concealment on terrain cells; simplified line of sight (LOS) using elevation and terrain blocking.
- Imperfect ground observations: estimated contact position, approximate strength, type, activity and heading.
- Radio tasks, typed messages, report delays, player requests, outgoing intelligence reports and autonomous ground-to-ground communication over configured links.
- Aircraft: travel, orbit, reconnoiter, provide CAS, return to base; fuel and ordnance constraints.
- Player's knowledge map: marker aging, reported coordinates, estimated movement cones, and report history.
- Basic rectangular grid drawing, aircraft and unit symbols, clickable coordinates, aircraft order controls, pause and speed control.
- Headless scenario runs for balancing and debugging.

### Explicitly deferred

 flare missions and illumination; crew assignment and fatigue; pilot autonomy within altitude bands, tactical flight patterns and aggressiveness; helicopter landing, medevac, resupply and troop lift; fixed-wing gunships; forward air controllers marking targets; multiple airbases and maintenance; weather and day/night mechanics; aircraft destruction and crew loss; mortars, anti-armor weapons and vehicles; realistic radio procedures, voice audio and interference; multi-echelon ground hierarchy; a persistent campaign; civilian simulation and rules of engagement; destructible terrain; advanced probabilistic tracking; complex enemy air operations; mistaken aircraft identification and friendly-fire damage; player-facing radio channels and channel contention; higher-command AI and dynamic CECON changes to ground objectives; report editing, player-authored enemy assessments and area-of-interest markers. These remain possible future features, not implicit v0.1 requirements.

## 3. Spatial model and time

- Coordinate system is continuous **world meters** (`Vec2`) with a grid providing terrain properties. All entities have true positions in the simulation.
- One fixed simulation step equals **one simulated second**. Player can pause or run at 1×, 2×, 4× or 8×. Rendering runs independently. Actions issued while paused are queued and take effect at the next tick.
- Ground movement, aircraft motion and radio-task progress update every second. Detection, ground tactical decisions and ground combat update every five simulated seconds; use fixed, documented ordering.
- A seeded random generator is owned by the simulation. Prefer stable per-subsystem/per-entity streams to prevent unrelated random draws from changing outcomes during tests.
- Each observation records its observation time. Each transmission records send and receive times separately. Receiving a stale report does not make its original observation fresh.

## 4. Ground formations and AI

A `GroundUnit` has identity, side, true position, personnel, equipment, morale, suppression, posture, objective, doctrine/training, local belief state, and radio-task state. Units can be any size, from a weapons team of two or three to a large formation.

**Objectives** are data, e.g. `HoldArea`, `MoveTo`, `PatrolArea`, or `WithdrawTo`. Each formation's standing objective and fallback position or area come from the scenario definition; no higher-command AI assigns them. **Doctrine** is a small set of behavioral parameters, not a faction-specific AI implementation.

The same decision function applies to both sides:

`decideGround(unitState, unitKnowledge, localTerrain, time) -> GroundIntent`

Formations move toward their objective using a simple terrain-aware route, observe nearby terrain and contacts, and take protection or become suppressed when incoming fire is intense. After significant events they continue, defend, investigate or withdraw using the rules in §4.0, §4.2 and §4.3.

**No omniscience:** Decision logic receives a unit's estimates, not the truth about opposing units. The combat resolver may use true positions to determine physical outcomes; that truth must never be passed to decision or reporting logic as if it were perceived. Physical navigation uses true coordinates in v0.1; persistent navigation error (§5.1) affects reports only.

### 4.0 Tactical behaviors

Contact does not automatically mean sustained engagement. Once a formation knows of an enemy, it chooses one of these reusable behaviors, drawn from military doctrine and battle drills:

| Behavior | Purpose | Fire | Ends when |
|---|---|---|---|
| **Observe / screen** | Detect and report while avoiding unnecessary engagement | Holds fire unless fired on | The enemy leaves, or closes inside the formation's standoff distance |
| **Probe** | Briefly engage to assess enemy strength and disposition | Short burst | A configured time limit passes or the estimate improves |
| **Harass / suppress** | Apply pressure without committing to decisive combat | Reduced rate, at range | Doctrine, ammunition or the enemy's response changes the choice |
| **Assault** | Commit to a decisive engagement, accepting greater risk and casualties | Full rate, closing | The objective is taken or a §4.2 threshold is crossed |
| **Disengage / reorganize** | Withdraw, recover suppression and cohesion, reassess objectives | Returns fire only | §4.2 recovery and return rules |

- The choice depends on standing orders, doctrine, perceived enemy strength, terrain, morale, ammunition and available support. The same function chooses for both sides, so differences come only from objectives, doctrine and capabilities.
- Patrols are generally standoffish: reconnaissance and security patrols favor observation, reporting and force preservation over prolonged firefights.
- A chosen behavior holds for a doctrine-configured minimum time, so that a formation doesn't change its mind on every update. Incoming fire can always end it early: a formation may return fire or disengage.
- A behavior's fire rate scales both its volley and its ammunition use.

### 4.1 Statistical ground combat

For the MVP, calculate combat effects at the formation level, not per soldier or bullet. A unit's effective fire depends on current personnel, ammunition, range, terrain/cover, suppression, and its current target assessment. Resolve ammunition usage, suppression and casualties at each combat update. Combat remains seeded and stochastic, but all effects for an update are calculated from one shared snapshot and then applied together, so entity order cannot change the outcome.

The combat equations and tuning constants belong in scenario/configuration data. No separate damage rules for friendly and enemy factions.

Suppression, morale and attrition are separate tracks:

| Track | Changes because of | Recovers |
|---|---|---|
| **Suppression** | Incoming fire | Quickly, once incoming fire decreases |
| **Morale / cohesion** | Casualties, isolation, sustained pressure and deteriorating conditions, more slowly than suppression | Slowly, while out of contact, up to a cap that falls with casualties |
| **Attrition** | Casualties and ammunition expended | Never |

- Being under fire must not continuously drain morale until a formation collapses. Fire alone can lower morale only to a doctrine-configured floor, and the loss doesn't stack with the number of firers. Going below the floor takes casualties, isolation or another deteriorating condition.
- Formations can exchange fire for extended periods without necessarily suffering substantial casualties.
- An air strike's morale effect is a discrete shock and isn't limited by the floor.

### 4.2 Disengagement, recovery and return

- **Disengagement:** A formation withdraws toward its configured fallback when risk, morale or casualty thresholds are exceeded. Low morale may make it abandon its objective rather than fight until destroyed.
- **Recovery:** Suppression and some morale recover while disengaged. Casualties and expended ammunition do not recover.
- **Return:** Whether a withdrawn formation returns depends on its standing order, remaining resources and doctrine. Each return must be justified by current capability: a formation must not advance, lose personnel, recover morale and attack again indefinitely.

Formations do not perform company-level strategic planning in v0.1.

### 4.2.1 Equipment

Weapon definitions state what a weapon can do; each unit's inventory states what it has and how much ammunition remains. There are no anti-aircraft or weapons-team unit classes, and the same AI operates every inventory.

| Weapon | Ground combat | Against aircraft | Tracked as |
|---|---|---|---|
| Small arms | Baseline fire | Only at low altitude | Aggregated with personnel |
| Machine gun | Stronger suppression, faster ammunition use | Limited, at low altitude | Individual systems |
| AAA | Usable against ground targets where in range | Dedicated | Individual systems |
| MANPADS | None | Dedicated, few missiles | Individual systems and missiles |

- A weapon definition holds its target domains, range, damage and suppression effects, crew required, ammunition use and, for air targets, its maximum altitude, hit chance and time between shots.
- Effective fire depends on the personnel available to crew each weapon, suppression, terrain, visibility and current behavior.
- Casualties can destroy specialist systems, so a unit can survive with its strength intact and lose its only machine gun.
- Each weapon type has its own ammunition; a unit with no ammunition left for any weapon counts as out of ammunition for §4.2.
- Equipment feeds the §4.0 behavior choice: a unit weighs what it can actually do, so a unit with no heavy weapons is less inclined to assault.

### 4.3 Responding to received information

Receiving intelligence updates a unit's knowledge, not its orders. The ground commander independently re-evaluates with doctrine-driven utility rules and decides whether to reposition, investigate, reinforce its defenses, disengage or continue its mission. The player cannot command ground movement through intelligence reports.

| Current objective | Incoming information | Potential response |
|---|---|---|
| Hold outpost | Enemy approaching | Reposition within the assigned area, and fight from prepared positions while the warning is current |
| Patrol sector | Weaker enemy sighted nearby | Investigate from standoff or observe |
| Patrol sector | Stronger enemy sighted nearby | Fall back and reinforce its fallback position, standing and fighting there |
| Advance toward objective | Enemy on route | Continue, change route, delay or reassess the objective |
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
- **Equipment:** An estimate can carry the weapons actually observed, which starts empty. Identifying a contact as hostile doesn't reveal its equipment. A weapon is observed when it fires or through a sufficiently good look, so a contact can hide an anti-aircraft team until it opens fire.
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
- Reporting uses priority and delay; engagement intensity modestly slows it, and heavy suppression, movement or an urgent withdrawal may delay or interrupt it.
- Failure to transmit now does not necessarily discard the report; retry/queue rules should be explicit.
- Capture the observation and original timestamp when detected, then allow the report to incorporate genuine newer observations before transmission.
- A player's `REQUEST_POSITION`, `REQUEST_SITREP` or `REQUEST_CONTACT_UPDATE` creates a high-priority task for the addressed ground unit, which answers from its own current knowledge, not with an immediate omniscient answer.
- Radio transport is reliable once the transmission completes in v0.1; no jamming, dropouts or encryption mechanics.
- Player transmissions take simulated time. There is no channel contention in v0.1.

### 6.2.1 Declaring a TIC

TICs emerge from autonomous ground combat, never from scripted mission triggers. Not every sighting or brief contact is a TIC or needs air support.

- A unit declares a TIC from its own beliefs about the threat, its mission and its casualties. Firing on a contact, or having a hostile nearby after firing earlier, isn't enough.
- It requests air support separately, and only when it judges its own resources insufficient. A TIC can therefore arrive with no support request.
- A TIC carries the unit's estimated position, the estimated enemy location and strength, and anything else the unit currently believes. Those are the unit's estimates, not truth.
- The fight keeps evolving while the report is transmitted, the player decides and aircraft travel. By the time an aircraft arrives, a TIC may have escalated, ended or moved.

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

**Contacts:** Store reported locations, strength ranges, heading, identification, source, confidence and age; avoid merging contradictory observations into ground truth. A new observation supersedes older ones within the same source track, and unidentified contacts stay unidentified on the map.

**Consolidation:** A fresh, confident aircraft sighting absorbs older reports that could be the same unit, judged only from their positions, ages and strength estimates. Age alone never merges anything. Consolidation can be wrong, because two close units can merge, so it happens only in the projection: stored reports stay unchanged, the marker lists its sources, and the player can split them. Weapons seen by any report carry over.

**Contact status:** A contact is active, hit, destroyed or not found, based only on reported evidence. A strike with an observed effect adds the crew's noisy casualty estimate and marks it hit or destroyed, and a kill closes reports likely to be the same unit. An aircraft that has had a clear look at a reported position and found nothing marks it not found. That can be wrong, because concealed units are missed, and any new sighting reopens the contact.

**Archive:** Reports not refreshed for a configured time leave the map, and closed ones go sooner. They stay in the radio log.

**Unit loss:** There is no automatic notification that a ground formation was destroyed. Evidence comes from silence or from an observed loss. A friendly unit silent for a configured time is flagged as out of contact, not as lost.

### 7.1 Aging and reachability visualization

- Ground-unit/contact markers gradually fade with observation age down to a **25% opacity floor**, remaining selectable.
- The original reported point remains the observation anchor and displays its age and source.
- Stationary/unknown movement: growing circle around the last reported position.
- Regions stop growing at a configured radius and fade out with age, so old reports don't cover the map. The marker itself stays at the opacity floor, and selecting it shows its region again.
- Direction of movement known: sector/cone originating at the reported position, oriented toward the reported heading, extending with plausible speed × elapsed time and widening as direction becomes stale.
- Known road movement may become a road corridor in a later version; v0.1 uses simple geometry.
- The cone represents a **possible region**, not a statistically calibrated probability contour. It never follows the hidden true unit trajectory.
- Aircraft positions, routes, mission states, fuel and ammunition are crisp and continuously updated for the player.
- Selected aircraft can show an approximate observation footprint; normal view hides all such footprints to reduce clutter. Terrain masking is computed without exposing hidden unit locations.

## 8. Aircraft simulation and orders

TICs can change air-tasking priorities, but deciding whether to divert an aircraft, keep supporting an engagement or return to base is the player's responsibility. Pilots retain autonomy for immediate defensive maneuvers; mission aborts and RTB are normally player decisions. The only automatic RTBs in v0.1 are the fuel rule in §8.2 and battle damage in §8.3.

Aircraft have ID, type, true and player-visible position, altitude, base, speed, fuel, ammunition, mission, damage state and sensor capability. Aircraft do not have independently simulated individual crew members yet. The airbase sits outside the map bounds, so aircraft positions can be off-map during transit.

Every aircraft is a real model, defined by data, and its role (recon or CAS) decides which orders it takes. Performance follows published figures where they matter to the game; see §8.5.

Player orders:

- `MoveTo(point)`
- `Orbit(point, radius)`
- `ReconArea(center, radius)`
- `SupportArea(center, radius)`
- `ReturnToBase`
- `SetAltitude(meters)`, separate from the mission, so an aircraft keeps its altitude across missions

Orders update missions; movement consumes simulated time and fuel. Aircraft can be retasked in flight, and aircraft launching from base incur a defined takeoff delay. Reconnaissance observes within a simplified footprint using air LOS and air concealment. Aircraft observations update the player's map automatically. Only a confirmed hostile that isn't already tracked from the air nearby generates a radio message, because the map already shows every sighting. Ground formations receive aircraft observations only when the player transmits them.

### 8.1 CAS engagement

CAS has three stages:

1. **Search:** The aircraft attempts to acquire a target within its assigned area using its own sensors. Its cue can come from player orders, existing intelligence or reconnaissance reports. A good reconnaissance cue can shorten the search, but it never makes a target visible automatically. If a report is stale or inaccurate, the aircraft may find nothing.
2. **Identify:** Identification may remain unknown or take time, but a confirmed classification is never wrong in v0.1.
3. **Engage:** An aircraft can attack only a contact it has identified as hostile. Unidentified contacts are never attacked.

Arriving at a reported TIC coordinate does not guarantee acquisition. Attacks are discrete passes. Each successful pass consumes ammunition and causes probabilistic suppression and casualties, modified by air cover and weapon characteristics, and can interrupt what the enemy formation was doing. Results flow through the shared ground-combat state rather than a scripted `support = success` flag. The player's click on a marker does not itself damage anything.

Contact position error and CAS search radius are tuned together, so that reconnaissance can make the difference between acquiring and missing a target.

The combat resolver prevents friendly-fire damage in v0.1. Aircraft report observed strike results automatically, never omniscient casualty counts.

### 8.2 Fuel, turnaround and aircraft presence

Aircraft return to base automatically before fuel runs out. Refueling/rearming uses simple fixed turnaround timers, configurable per aircraft type.

Enemy ground units react to aircraft through their own AI, and only if they detect the aircraft. There is no automatic suppression aura around an orbiting aircraft: a formation that notices aircraft goes to ground briefly, then carries on, and won't take cover again for a doctrine-configured time unless it is actually attacked.

### 8.3 Altitude and ground fire

Terrain affects aircraft: this section's rules are extended by §8.4.

- **Altitude:** Every aircraft has an altitude in meters above the ground, and 0 means on the ground. Aircraft at base are at 0. The player sets each aircraft's target altitude, within limits for its type, starting from a scenario default. Aircraft climb and descend toward it at a rate set per type, so altitude can't be changed instantly to dodge fire. Starting the scale at 0 leaves room for landing helicopters.
- **The tradeoff:** Higher is safer and less effective. Ground fire weakens and then stops as an aircraft climbs past each weapon's ceiling. Sensor quality falls with altitude, which hurts detection, identification and position estimates alike. Strike accuracy falls too, because altitude adds to the miss distance. Low flying improves sensors but brings small arms and machine guns into reach.
- **Later:** The altitude order is a single target for now. With more pilot autonomy it can become a band, with pilots choosing where to fly inside it.
- **Noticing and deciding:** Ground units use the existing aircraft-notice rule. Firing is a choice made through the shared behavior framework: a unit weighs how well its weapons can reach the aircraft against giving away its position. A unit with no useful weapon stays concealed.
- **Risk:** A weapon can engage only within its range, measured in three dimensions, and at or below its maximum altitude. The chance of a hit per engagement falls with altitude and distance, and is further reduced by crew, suppression and concealment rules. Risk also grows with time spent in reach. At the default altitude small arms can't reach aircraft, and machine guns only barely. Flying lower changes that.
- **Damage:** One hit damages the aircraft. Its mission ends at once and it returns to base automatically. Damaged aircraft are never destroyed in v0.1, but take a longer, configurable repair turnaround before flying again. Their sensors and ordnance remain available on the way home, but they don't attack.
- **What the player learns:** Telemetry shows the damage immediately, and the aircraft reports being fired on, with an estimated source position and the weapon if observed. Any `CAS inbound` promise that depended on the aircraft is corrected automatically (§6.3).
- **Exposure:** Firing makes a unit easier to detect from the air and may reveal its equipment, so a CAS aircraft can attack it under the normal §8.1 rules. Anti-aircraft fire is resolved through the shared combat state and uses no faction rule.

### 8.4 Terrain and aircraft

Terrain blocks aircraft line of sight and engagements in both directions.

- **Altitude datum:** Altitude is measured from the map's datum, not from the ground beneath the aircraft, so an aircraft can fly behind a hill. Terrain elevation uses the same datum, and an aircraft on the ground is at ground level.
- **Clearance:** Pilots keep a configured minimum clearance over terrain whatever the order says. This is immediate flying, not a mission decision, so it needs no player command.
- **Line of sight:** Every air-ground check traces a line between the two through the terrain. That covers aircraft sensors, a ground unit noticing an aircraft, ground fire and CAS passes. Terrain between them blocks it.
- **Weapons:** A weapon's range and ceiling are measured from the weapon's own position, so a team on a hill reaches higher.
- **Tactics this should allow:** A low aircraft behind a ridge can't be seen or shot at, and can't see or strike either. CAS can approach masked and rise to attack, which is the reason to fly low.
- **Terrain scale:** The map needs relief of a few hundred meters for this to matter. Its current 70 m is too little.

### 8.5 Aircraft models

Speeds, endurance and ordnance come from published figures, which often disagree, so these are rounded choices. Game effects such as armor and strike accuracy are judgment calls based on each aircraft's reputation.

| Model | Role | Real figures used | Game character |
|---|---|---|---|
| O-1E Bird Dog | Recon | About 110 mph cruise, 4.7 hours' endurance, no weapons | Slow and long-lasting. Excellent eyes low down, poor from height, unarmored |
| RF-101C Voodoo | Recon | About 550 mph cruise, cameras | Fast, wide turns, sensors that hold up at height. Defined but not in the first scenario |
| A-1E Skyraider | CAS | About 200 mph cruise, 7,000 lb load, 15 hardpoints | Slow, accurate, carries many passes, rugged, stays for hours |
| F-100D Super Sabre | CAS | About 565 mph cruise, up to 6,000 lb load | Arrives fast, hits hard, fewer passes, less accurate, wide turns, short endurance |
| UH-1B Huey gunship | CAS, helicopter | About 126 mph cruise, M60s and rockets | Hovers, flies low, frequent light attacks that mainly suppress, vulnerable |
| AH-1G Cobra | CAS, helicopter | About 170 mph cruise, minigun and rockets | Faster and better armed than the Huey. Defined but not in the first scenario |
| OH-6A Cayuse | Recon, helicopter | About 125 kt cruise | Superb eyes very low down, poor from height. Defined but not in the first scenario |

- **Compressions:** Turnaround and repair times are far shorter than reality, so aircraft can fly more than once in 75 minutes. Altitude is capped at 3,000 m, well below real ceilings, because nothing tactical happens higher.
- **Speed and armor:** A model's hit chance is scaled for how hard it is to track, and rugged airframes have a chance to survive a hit and keep flying.
- **Helicopters:** They hold position on station instead of orbiting, keep a much smaller terrain clearance, and start lower. They use the same orders and CAS rules as everything else. Landing is not modeled, so a helicopter only touches down at base.
- **Going home:** A long-endurance aircraft can outlast its ordnance. It stays on station until ordered back, so a spent aircraft is the player's problem.

## 9. Player interface

Desktop-browser layout:

1. **Main Canvas map:** Grid terrain, simple elevation/terrain tint, aircraft icons and paths, ground unit reported markers, enemy contact estimates, uncertainty cones, TIC flags, selectable reported positions.
2. **Radio panel:** Chronological message log with type/source/time; clickable reported coordinates; structured responses, report requests and contact forwarding.
3. **Selected aircraft panel:** Current mission, fuel, ammunition, available orders and target/area selection.
4. **Altitude profile and fleet list:** Airborne aircraft, plus the selected one, side by side on one altitude scale. Clicking a column selects that aircraft, dragging sets its target altitude in 100 m steps, and hovering shows its details. Lines mark the ceilings of weapons actually observed, so the profile never reveals a weapon the player hasn't seen. Beneath it, a scrolling list gives every aircraft one line with status, mission, altitude, fuel and ordnance, so the panel still works with many more aircraft.
5. **Global controls:** Pause, 1×/2×/4×/8× speed, current simulated time, objective and support-request list.

Interaction requirements:

- The map always shows a north arrow and a scale bar that follows the zoom; north is always up, because the map doesn't rotate.
- Marker size follows reported strength, and a hollow marker means unknown strength or not found. A `×3` badge shows consolidated reports.
- A Summary tab beside the radio gives a report-based picture: known enemy strength as a range, HQ's starting estimate, reported losses, what is unlocated, strength by sector, air threats, friendly status, the force ratio at the outpost and air activity. Its high end counts every report as a separate unit and its low end counts possible duplicates once, so good reconnaissance shows up as a narrower range. Everything comes from the `PlayerView`.
- When a run ends, the Summary tab adds a debrief comparing estimates with what really happened. This is the only time the player sees truth.
- The map shows height through hillshading and contour lines every 20 m.
- Hovering the map shows the grid reference and elevation under the cursor, and nothing off the map.
- Selecting an aircraft shows a terrain profile along its path to its destination, with its altitude and any ridges in the way.
- Contact markers show the weapons observed: nothing for small arms or none seen, a small `MG` tag for machine guns, and a magenta chevron with an `AAA` or `MP` tag for anti-aircraft weapons. Tags fade with the marker. A plain marker means weapons not observed, not that there are none, and a legend says so.
- Selecting an anti-aircraft contact shows a threat ring where the chance of a hit stays above a configured risk per minute, at the altitude of the most recently selected aircraft. It reflects the weapons observed and the last reported position, so it is an estimate, not a guarantee of safety outside it.
- Ground fire leaves a fading mark at the estimated source for a configured time, tagged with the weapon if the crew saw it. Marks close together merge into one, keeping the newest time and any hit or weapon reported. Marks show details on hover and aren't selectable.
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
- `GroundUnit`, `GroundObjective`, `GroundPosture`, `GroundBehavior`, `Doctrine`, `UnitKnowledge`, `WeaponType`, `WeaponDefinition`, `Equipment`
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
  observedWeapons: readonly WeaponType[];
}>;
type WeaponType = 'SMALL_ARMS' | 'MACHINE_GUN' | 'AAA' | 'MANPADS';
type TargetDomain = 'GROUND' | 'AIR';
type WeaponDefinition = Readonly<{
  type: WeaponType;
  targetDomains: readonly TargetDomain[];
  rangeMeters: number;
  suppressionEffect: number;
  damageEffect: number;
  crewRequired: number;
  ammunitionPerUse: number;
  maxAltitudeMeters: number;
  airHitChance: number;
  airCycleSeconds: number;
}>;
type Equipment = Readonly<{ weapon: WeaponType; quantity: number; ammunition: number }>;
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
- At least one hostile formation is a small anti-aircraft team that reconnaissance can miss or fail to recognize, so a CAS tasking can meet a threat the player didn't know about.
- At least two spatially separated threats should compete for the player's attention. Ground units generate TIC and contact reports according to their observations and radio readiness.
- Mobile formations, periodic reports and situations where reconnaissance is valuable are required, because scenario length alone does not create meaningful information uncertainty.
- **Pacing:** The battle has intermittent contact, probing, maneuver and attrition, not every formation fighting continuously until one side collapses.
- **Differentiated enemy roles:** Enemy formations have reconnaissance, harassment, assault and reserve roles, expressed through doctrine and objectives. A formation's objectives may be an authored schedule in the scenario file. That is data, so it is not the higher-command AI deferred in §2.
- **Early warning:** The player gets actionable intelligence early enough to anticipate major engagements, not merely react once defeat is imminent. Assault formations therefore assemble where reconnaissance can find them before they commit.
- **The challenge:** Air support stays necessary for the primary objective, but difficulty comes from timing, resource allocation, reconnaissance and responding to changing ground conditions.
- **Capture:** The outpost is captured when the enemy has sufficient effective strength inside the objective area, friendly defenders are below a minimum effective strength, and both conditions persist for 60 seconds.
- **Success:** The outpost has not been captured at the deadline and a configured minimum of effective defenders remains. Failure and partial outcome statistics are still recorded even if the objective is lost.

| Provisional parameter | Value |
|---|---|
| Map | 5 × 5 km, 50 m cells (100 × 100 grid) |
| Duration | 75 simulated minutes |
| Aircraft transit | About 2–9 minutes, from each model's real speed |
| On-station endurance | From each model's fuel; slow types usually run out of ordnance first |
| Turnaround | About 10 minutes, configurable per model, and compressed from real times |
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
- An incoming report changes a ground formation's selected tactical behavior in a deterministic test case, and never changes its objective.
- A formation under fire with no casualties or other deterioration stops losing morale at its floor, however many units fire on it.
- Suppression recovers after fire stops, while casualties and expended ammunition do not.
- A patrol that can stay at standoff observes and reports instead of starting a prolonged firefight.
- A brief or unthreatening contact produces no TIC; a TIC can occur without a support request.
- Two units with the same inventory get the same capabilities whatever their side or doctrine name, and losing a weapon's crew or the weapon removes its capability.
- A contact's estimate never lists a weapon that hasn't been observed.
- A hill between an aircraft and a ground unit blocks sensing, noticing, ground fire and strikes in both directions.
- Pilots keep minimum terrain clearance whatever the altitude order.
- Aircraft at base have altitude 0, climb and descend at their type's rate, and stay within their type's limits.
- Higher aircraft detect less and strike less accurately, and an altitude order survives a change of mission.
- The altitude profile shows ceilings only for observed weapons.
- Consolidation changes the map, never the stored reports, and needs a fresh, confident aircraft sighting.
- A clear look that finds nothing closes a report, and a new sighting reopens it.
- Battle summary figures come only from the `PlayerView`, and the debrief is unavailable until a run ends.
- Hit chance falls with altitude, reaches zero above a weapon's maximum altitude, and is zero beyond three-dimensional range.
- A hit damages the aircraft, ends its mission, sends it home and applies the repair turnaround; it never destroys the aircraft.
- An aircraft's damage corrects any `CAS inbound` promise that depended on it.
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

**Tempo:** Combat tempo, casualty rates, suppression recovery, morale deterioration, engagement duration and withdrawal behavior are measured separately from win rates, and `npm run sim` reports them. The targets below are provisional. Values are medians for the no-air policy, over 300 seeds on the revision 3 rules and 1,000 seeds after M7.

| Metric | Revision 3 | After M7 | Initial target |
|---|---|---|---|
| Share of minutes with fire anywhere | 68% | 76% | 30–50% |
| Separate bouts of fire (over 2 minutes apart) | 2 | 4 | At least 5 |
| First decisive assault near the outpost | Not measured | Minute 43.25 | No earlier than about minute 45 |
| First enemy fire on the outpost garrison | Minute 36.8 | Minute 44.4 | None |
| Earliest capture | Minute 46.8 | Minute 55.2 | No earlier than about minute 55 |
| Warning before the first decisive assault, informed | Not measured | 40.7 minutes | At least 10 minutes |
| Share of withdrawals triggered by morale / suppression / casualties | 43% / 57% / 0% | 65% / 33% / 1% | No single trigger dominates |

Warning counts from the first hostile contact the player holds within 1.5 km of the outpost, which may be a screen rather than the assault formation.

## 13. Delivery milestones

| Milestone | Main deliverable | Key question |
|---|---|---|
| **M1: Ground simulation** | Autonomous ground combat, terrain, basic AI, debug Canvas, abstract air intervention | Can air meaningfully swing the battle? |
| **M2: Knowledge** | Detection, contact estimates, track aging, radio tasks, autonomous ground information exchange | Can units make decisions from incomplete information? |
| **M3: Air operations** | Aircraft motion, reconnaissance, CAS acquisition, fuel and ordnance | Do allocation and reconnaissance matter? |
| **M4: Player interface** | Operational map, radio log, contact forwarding, information requests, aircraft orders | Does the gameplay loop work end to end? |
| **M5: Ground behavior** | Tactical behaviors, separated morale, threat-based TICs, differentiated enemy roles, tempo metrics | Does the battle develop in stages instead of one collapse? |
| **M6: Equipment** | Weapon definitions, unit inventories, equipment-derived combat and AI, per-weapon ammunition | Do capabilities come from equipment without breaking the battle? |
| **M7: Air threat** | Altitude, ground fire against aircraft, damage and forced RTB, hidden anti-aircraft teams | Do hidden threats make tasking decisions more interesting? |
| **M7.5: Altitude** | Player altitude control, its costs, the altitude profile | Does altitude give the player a real answer to hidden air defense? |
| **M7.55: Situational awareness** | Marker sizes, contact statuses, archive, consolidation, battle summary, debrief | Can the player tell who is winning? |
| **M7.6: Terrain and aircraft** | Altitude datum, air line of sight, masked engagements, taller terrain, path profile | Does terrain give CAS a reason to fly low? |
| **M7.7: Aircraft models** | Real Vietnam-era aircraft with their own performance, armor and altitude costs | Do different aircraft make different decisions? |
| **M7.8: Helicopters** | Hovering gunships and scouts, with landing and ground-interaction roles deferred | Do helicopters use terrain differently from jets? |
| **M8: Squads** | Skipped for now: subordinate elements, grouped markers, covering fire and maneuver | Does squad detail matter from the player's seat? |
| **M9: Calibration** | Reproducible policy testing, tuning, usability refinements, documentation of known simplifications and tuning values | Are the success-rate and information-value targets satisfied? |

Calibration starts in M1 and continues throughout development; M9 is final tuning, not the first check of whether the game is viable.

## 14. Definition of done

v0.1 is complete when a player can load the initial scenario, receive a self-reported TIC from an autonomous ground formation, click its imperfect reported coordinates, task an aircraft via the map, obtain better information from reconnaissance, optionally forward that information to selected friendly ground units, and measurably influence the autonomous battle. Fuel, ammunition and time constrain the decisions. The map shows uncertainty rather than hidden truth. A reproducible headless test suite demonstrates that the initial scenario needs effective air intervention and that choosing how to intervene matters.
