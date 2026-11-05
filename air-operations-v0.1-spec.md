# Air Operations Controller — v0.1 Specification

**Status:** Draft for implementation  
**Version:** 0.1, revision 11 (design rules frozen for v0.1; numeric values are provisional until calibrated)  
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
- Weather: moving storm systems with cloud ceilings and rain, and an imperfect forecast.
- Ground fire against aircraft, with risk tied to altitude; a hit damages the aircraft and forces it back to base.
- Ground/air cover and concealment on terrain cells; simplified line of sight (LOS) using elevation and terrain blocking.
- Imperfect ground observations: estimated contact position, approximate strength, type, activity and heading.
- Radio tasks, typed messages, report delays, player requests, outgoing intelligence reports and autonomous ground-to-ground communication over configured links.
- Aircraft: travel, orbit, reconnoiter, provide CAS, return to base; fuel and ordnance constraints.
- Player's knowledge map: marker aging, reported coordinates, last known positions with heading and time seen, and report history.
- Basic rectangular grid drawing, aircraft and unit symbols, clickable coordinates, aircraft order controls, pause and speed control.
- Headless scenario runs for balancing and debugging.

### Explicitly deferred

 flare missions and illumination; crew assignment and fatigue; pilot autonomy within altitude bands, tactical flight patterns and aggressiveness; helicopter landing, medevac, resupply and troop lift; fixed-wing gunships; forward air controllers marking targets; multiple airbases and maintenance; wind effects, valley fog, weather effects on troop movement, flight safety and pilot behavior, and day/night mechanics; aircraft destruction and crew loss; mortars, anti-armor weapons and vehicles; realistic radio procedures, voice audio and interference; multi-echelon ground hierarchy; a persistent campaign; civilian simulation and rules of engagement; destructible terrain; advanced probabilistic tracking; complex enemy air operations; mistaken aircraft identification and friendly-fire damage; player-facing radio channels and channel contention; higher-command AI and dynamic CECON changes to ground objectives; report editing, player-authored enemy assessments and area-of-interest markers. These remain possible future features, not implicit v0.1 requirements.

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

### 4.0.1 Squads and platoons

The squad is the smallest simulated combat unit. A `units` entry in a scenario file describes a platoon, and a platoon is a command relationship between squads, so nothing ever physically splits. Zoom never changes the simulation.

- **Forming up:** A platoon divides into squads of about `combat.squadSize`, sharing out its people, weapons and ammunition. Each squad has a fixed slot. A platoon starting on its hold area spreads around it, and any other platoon starts in column towards its objective.
- **What a squad owns:** Position, personnel, equipment, suppression, posture and its current fight. Combat, strikes and perception work squad by squad.
- **What a platoon owns:** Objective, fallback, schedule, morale, mode and returns. It takes the §4.2 withdraw and return decisions from totals across its squads, so the whole platoon goes together and squads don't drift away one at a time.
- **Shared picture:** A platoon has one picture, so what one squad sees, all its squads know. A squad can only fire at what it has a line of sight to.
- **Radio:** Links, reports, requests and forwarded intelligence all use platoon IDs, so the player's radio doesn't grow with the number of squads. A platoon's radio works at the pace of its lead squad, the first with people left.
- **Reporting:** Hostile contacts close together are reported as one group with their combined strength, so a platoon of five squads reports one enemy platoon rather than five contacts. Thresholds for a TIC or support request read the same combined strength.
- **Strikes:** A crew aims at its estimate and takes a new look after each pass. A pass hits every enemy squad near the aiming point, each by how close it is to that point, while the moral effect counts once per platoon.
- **Aircraft:** Crews see squads one at a time. Each is a separate contact, and the map draws nearby contacts as a cluster (§9).

### 4.0.2 Battle drills

A drill is a platoon's shared answer to a situation, taken from published small-unit drills. Each is plain data in `src/ai/drills.ts`: what starts it, the role of each squad, and what ends it. A doctrine lists the drills a side knows and sets their numbers, and both sides run the same code. A platoon chooses from its own picture, so what it has been told changes which fight happens.

| Drill | Starts when | Squads | Ends when |
|---|---|---|---|
| **Near ambush** | Under fire from inside `nearAmbushMeters` | All assault through | The enemy is gone from the picture |
| **Far ambush** | Under fire from further away | Nearest give support by fire, the rest flank | The enemy is gone |
| **Attack** | An `AssaultArea` objective, or a known position on the route that the platoon chooses to attack | Nearest give support by fire, the rest flank and assault | The platoon is on the area and its picture shows it clear |
| **Bypass** | A known position on the route that is too strong or there's no time to attack, or a far ambush from a stronger force | All route around it, returning fire | The position is behind them |
| **Hasty ambush** | A moving enemy reported coming towards them | All hide and hold fire until close | The enemy is gone |
| **Wait for air** | A known position on the route, when the platoon can call Air Ops and waiting is worth it: the position is at least `waitForAirStrengthRatio` of the platoon's strength, there's time to wait `airWaitSeconds` and still arrive, air operations hasn't said no in the last `airRefusedMemorySeconds`, and the enemy there can't see it. It asks for guns on the position, once | All hold | Support arrives, then **push through**, or nobody answers in `airWaitSeconds` |
| **Push through** | Air has arrived over a position the platoon waited at, or air operations has announced that the position ahead, or the one firing on it, is being suppressed now | All move on past it on their route, returning fire. Under an announced suppression they keep going even when fired on from close, rather than assaulting into the fire | The position is behind them |

- **Support by fire:** Not a drill of its own, but the role that pins an enemy while others move. The share of squads comes from doctrine.
- **Choosing at a known position:** The platoon estimates the enemy's strength from all its reports and contacts there. It attacks up to `attackStrengthRatio`, and otherwise bypasses, unless the way around is over `maxDetourFactor` times as long. It also bypasses if there isn't time to attack.
- **Flanking:** A flanker goes to a point `flankMeters` to one side of the enemy, choosing the side that the enemy can't see and that has more cover, then keeps clear of the enemy on the way there. Routes avoid the enemy's position, not every line of sight.
- **Positions, not units:** A drill works on positions as the platoon sees them, never on a unit. Squads move to an estimated position and fire at a point on the ground, and fire hits whoever is actually near that point, within `fireSpreadMeters`. A bad estimate can miss, a position can be suppressed with nobody in view, and firing on an empty position wastes ammunition.
- **Handled positions:** A position a platoon has dealt with stays dealt with, so a report it found empty can't stop it twice.
- **Time limit:** Every drill ends after a doctrine-set time, so a drill can't hold a platoon forever.
- **Radio:** Starting a drill sends a `DRILL` message, so the player can see a forwarded report change what a unit does.

**Objectives:** `AssaultArea` attacks an area and ends when the platoon's own picture shows it clear. `AmbushArea` hides on an area and holds fire until the enemy is inside `openFireMeters`, or until the platoon is fired on, then holds the area.

**Orders:** A platoon's `objectiveSchedule` can start its next objective at a time, when its current objective ends, or when a contact is reported. A reported contact gives an `AssaultArea` at the reported position. This acts on the report rather than the truth, so a late or wrong report sends the platoon late or to the wrong place.

**Hidden posture:** A unit that isn't moving or firing can hide. It is far harder to see from the ground, and less so from the air, so recon can still find an ambush that a column would walk into.

**What a warning buys:** A sprung ambush fires at `ambushSurpriseFactor` times its normal effect for `ambushSurpriseSeconds`, but not at a platoon already running a drill that a warning gave it. A report also multiplies a unit's chance of spotting anything hidden near the reported position.

**Rallying:** A doctrine with `rallyMeters` pulls back that far from the enemy and carries on, instead of returning to its authored fallback, unless it is holding ground.

### 4.0.3 React to contact

Every unit on both sides answers fire the same way, from its own picture of its fight (§7.3). It follows the first battle drill every soldier learns (FM 7-8): return fire, take cover, find the enemy, then decide.

- **The shooter first:** Under fire, a unit aims its reaction at a contact it believes is firing on it, not at whatever enemy is nearest. That shooter becomes its target for return fire and behavior choice, and the contact a drill starts from (near ambush, far ambush, bypass).
- **Unseen fire:** A unit fired on by someone it can't see fires back toward where the fire comes from, at `blindFireRangeMeters`, or its engagement range if that is shorter. Fire lands on whoever is really there, so firing the right way can hit and pin an unseen enemy, and firing the wrong way only spends ammunition. A unit holding ground stays put. A unit going somewhere keeps moving on while it fires.
- **Looking for the shooter:** Spotting is `fireCueBoost` times likelier toward where unseen fire comes from, so a hidden shooter becomes a contact sooner, and is reported.
- **Taking cover:** Pinned units still go to ground, as before. Being fired on doesn't add a separate pause, so columns keep their tempo.
- **Doctrine:** `reactToFire` turns all of this on for a doctrine. It is on for every doctrine by default.

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

### 4.1.1 Wounded

Casualties are numbers, not individuals (DESIGN.md, philosophy 7). The same rules hold for both sides; only the enemy has no medevac to call.

- **Killed and wounded:** Each casualty is wounded with chance `woundedShare` and killed otherwise. Wounded leave the fight at once, as casualties always have, but stay with their squad. They are kept as groups by the time they were hit, so each group knows how long it has waited.
- **Dying of wounds:** A group of wounded loses men at `woundDeathPerHour`, a rate that grows with the time waited: it doubles after `woundWorsenSeconds`, triples after twice that, and so on. Wounded aboard a helicopter stop dying; the flight counts as care. Wounded whose squad has no fit men left are lost with it and count as killed.
- **Carers:** Each wounded man ties down `carersPerWounded` of a fit man. Carers don't fire, so a squad fires with its fit men less its carers. Carrying slows a squad on the move: its speed falls by `woundedSlow` times the ratio of wounded to fit men, at most that much.
- **Holding for the wounded:** A platoon on the move whose men free to fight (fit men less carers) fall below `woundedHoldShare` of its starting strength stops advancing and holds where it is until its wounded are out, by helicopter or by dying. A platoon holding ground already stays put. Withdrawal and its thresholds are unchanged and count only fit men, as before.
- **Morale:** Wounded waiting longer than `woundedMoraleSeconds` are a deteriorating condition, like isolation (§4.1): they take morale below the fire floor while the platoon is under fire. They don't stop it recovering out of contact; a first version that did made every scenario unwinnable.
- **Reports:** A SITREP gives the wounded with the unit, as well as its fit men.

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

### 5.1.1 Facing

A squad faces the way it is moving, the enemy it is firing at, or, on an `AmbushArea` with `watches`, the ground it covers. Crews sometimes see this on a stationary squad, with some error, and the marker shows it as a short line. Nothing labels an ambush: several still squads facing the same stretch of road is a pattern for the player to read.

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

**Expected support:** The player never types or chooses an arrival time. `CAS inbound, ETA four minutes` is available only while a CAS aircraft is watching or covering with weapons free, or suppressing or striking, an area covering, or within a configured distance of, the recipient's last reported position. The ETA is calculated from that aircraft's mission. If the aircraft is diverted, delayed or returns to base, air operations automatically sends an update, which takes simulated time like any other transmission. An estimate that is never updated lapses after a configured grace period past its ETA.

### 6.4 Points of interest

Right-clicking the map opens a menu of things the player can report there, and a mark goes out by radio to the units chosen. Kill zone is the first kind, and a new kind is one entry in `POI_KINDS`. A mark is the player's opinion: it never reads truth, and it may be wrong.

- A recipient treats a suspected kill zone as a low-confidence enemy position of unknown strength, so it can start a bypass or attack (§4.0.2), and it watches that ground harder.
- A wrong mark costs real time. An ambush nobody marked still gets sprung.
- Right-clicking an existing mark can cancel it, which also goes out by radio.

## 7. Player knowledge and map projection

Maintain `WorldTruth` and `PlayerKnowledge` as separate states. Only a deliberately filtered `PlayerView` reaches UI code. The projection takes only `PlayerKnowledge`, aircraft telemetry and simulation time as input, never `WorldTruth`. A debug-only omniscient view is permitted but is clearly marked and cannot be activated by ordinary gameplay commands.

**Map updates:** All received aircraft observations update the operational map automatically. Ground reports update it only after successful delivery to air operations.

**Friendly ground location:** Use received position reports and aircraft observations that identify a friendly formation. Apply a simple deterministic evidence rule considering source accuracy and freshness. A newer self-report usually updates the marker unless a comparably recent, more reliable aircraft observation contradicts it; record the discrepancy instead of silently deleting a report.

**Contacts:** Store reported locations, strength ranges, heading, identification, source, confidence and age; avoid merging contradictory observations into ground truth. A new observation supersedes older ones within the same source track, and unidentified contacts stay unidentified on the map.

**Tracks (§7.2):** Air operations keeps one track per suspected enemy group, and the map shows one marker per track.

**Contact status:** A contact is active, hit, destroyed or not found, based only on reported evidence. A strike with an observed effect adds the crew's noisy casualty estimate and marks it hit or destroyed, and a kill closes reports likely to be the same unit. An aircraft that has had a clear look at a reported position and found nothing marks it not found. That can be wrong, because concealed units are missed, and any new sighting reopens the contact.

**Archive:** Reports not refreshed for a configured time leave the map, and closed ones go sooner. They stay in the radio log.

**Unit loss:** There is no automatic notification that a ground formation was destroyed. Evidence comes from silence or from an observed loss. A friendly unit silent for a configured time is flagged as out of contact, not as lost.

### 7.1 Aging and last known positions

- Ground-unit/contact markers gradually fade with observation age down to a **25% opacity floor**, remaining selectable.
- A marker always stays at the reported point, the last known position, and shows its age and source.
- **Stale reports follow the NATO convention:** once a contact hasn't been seen for `staleSeconds`, its frame is dashed (not confirmed present) and it carries the time it was last seen. A contact seen moving keeps its direction-of-movement arrow.
- **The map draws no region of where it might be now.** Earlier versions drew a growing circle, or a cone along the heading. They suggested a knowledge the game doesn't have and weren't much help. Estimating where a unit has gone, from its last position, heading and time, is the controller's own judgment, as it is for a real operator.
- Aircraft positions, routes, mission states, fuel and ammunition are crisp and continuously updated for the player.
- Selected aircraft can show an approximate observation footprint; normal view hides all such footprints to reduce clutter. Terrain masking is computed without exposing hidden unit locations.


### 7.2 Tracks, claims and source ratings

Air operations works like a track manager: it decides which reports describe one enemy group, from the estimates alone, and it can be wrong.

- **Correlation:** Each report that reaches air operations is matched, once, against the live tracks. It joins the nearest track it could belong to, and opens a new track if there is none. The gate a report must pass:
  - **Position:** within three times the two estimates' combined error, plus how far the unit could have moved at a plausible speed since the track was last seen. Estimates from different sources err independently, so a tighter gate splits one unit into two.
  - **Side:** no hostile report joins a friendly track, or the reverse. Unidentified joins either.
  - **Size:** head counts within a factor of two of each other, since a squad near the edge of a size band often lands in the next one. A report of several squads as one group joins only a track of the same kind.
  - **Same source:** a track that already holds a different contact from the same source is ruled out, because that source could already tell the two apart.
- **Ambiguity:** If more than one track could take the report, it joins the nearest and the track is flagged as possibly two groups.
- **Track numbers:** Tracks are numbered from TN 4001, as on a tactical data link, and the number stays with the track.
- **Each part from the best source:**

  | Part | Comes from |
  |---|---|
  | Position, heading, activity | The most precise report once its age is counted: usually an aircraft overhead, and the ground again once the aircraft has gone |
  | Strength | A platoon in a firefight with it, in the last five minutes, since it counts the men shooting at it. Otherwise the same report as the position. |
  | Side | Hostile if any source in contact, or any confident source, says so |
  | Weapons | Everything anyone saw |
  | Status | Destroyed only if nobody has seen it since it was reported destroyed. Not found only if every report was looked for and missed. |
- **Position from several reports:** A track's position is the average of its comparable reports, those within twice the best one's error once age is counted, each weighted by the inverse square of its error, as a Gaussian update would. Two good sightings that agree beat either alone, and the track's stated error shrinks accordingly.
- **Merging:** Every five seconds air operations revisits its tracks. Two fresh tracks that pass each other's gate, with no source in common, are merged. A stale track is merged into a fresh one only if exactly one fresh track is within reach of where its unit could have gone; with two or more, it stays as a last known position. The older number survives and lists the ones merged into it.
- **Never deleted:** Stored reports are never changed or deleted. A track lists its reports, and the player can split it apart on the map.
- **Casualty claims:** A ground unit that has fired in the last `claimWindowSeconds` and sees men fall within `claimAimMeters` of where it is firing believes it hit them. It claims `claimOptimism` men for each one that fell, with noise. It can't tell its own hits from anyone else's, so it claims those too. A position it was firing on that goes quiet is claimed in full. Claims travel in its contact reports, and a report of a group carries the group's claims.
- **Deconflicting claims:** On a track, each source counts once, at its highest claim. The track takes the largest ground claim rather than the sum, because units watching one fight claim the same men. Aircrews' strike assessments are separate passes, so they add. Even so, claims run high, as they do in real fighting.
- **Condition:** NATO's fire-effect terms set the bar under the symbol. Under a tenth of the estimated strength claimed is green. From a tenth to three tenths is yellow, **neutralized**. Three tenths or more is red, **combat-ineffective**, which doctrine calls destroyed. The game keeps "destroyed" for a unit nobody is left in.
- **Source ratings:** Each contact shows an Admiralty rating (§9). After the run, the debrief rates every source on its real record:
  - how far off its estimates were, on average,
  - how many friendly units it reported as hostile,
  - what it claimed, counted once per enemy squad, which only the debrief can do,
  - a reliability letter: A within 60 m on average, B within 120 m, C within 250 m, D beyond that, and E for any friendly reported as hostile.

  The debrief also sets aircrew and ground claims against the enemy's real losses.

### 7.3 Fire on the ground

The controller needs to know who is fighting whom, to choose what air should hit first. The map shows fire only as far as someone saw it or said it. There are four levels of evidence, each drawn differently.

| Evidence | Where it comes from | On the map |
|---|---|---|
| Seen from the air | A crew watching a unit fire sees which way the fire goes, and whom it lands on if the crew can see them too. | A solid arrow from shooter to target. If the target isn't seen, a short solid stub in the direction of fire. |
| Under fire | A unit says it is being fired on, light or heavy. | UNDER FIRE or HEAVY FIRE beside its symbol. |
| Fire from | A unit says where the fire comes from: a contact it can see, or only a direction. | A dashed arrow from the contact's track to the unit, or a pale dashed wedge pointing in at the unit from that direction. |
| Engaging | A unit says which contact it is firing at. | A dashed arrow from the unit to that contact's track. |

- **What a unit knows (`perception/fire.ts`):** A squad feels any fire landing near it, from the squads that fired. If its platoon holds a fresh contact on the shooter, the fire comes from that contact, errors included. If not, the squad has only a direction, off by `fireBearingErrorRad`, and directions within `fireSectorRad` of each other are one. Fire is **heavy** while the squad is losing men or pinned. A squad firing reports the contact nearest where it aims, within `engageMatchMeters`. All of this lasts `fireMemorySeconds` after the last shot, and is the unit's own picture: it never names a shooter it hasn't seen.
- **Reports:** Troops-in-contact calls, SITREPs, position reports and support requests carry the sender's fight. No new message is sent for it, so the radio gets no busier and the picture is as late as the unit's last report. A report from the same unit with no fight in it clears the old one. Asking a unit for a SITREP or its position refreshes it.
- **Crews:** A crew that sees a unit firing sees the direction of fire within `tracerErrorRad`. If it can also see a unit where the fire lands, it sees both ends. Both sides' fire counts, so a crew can find an enemy position that has never reported itself by watching where the fire on a friendly unit comes from.
- **Never shown:** fire nobody saw or reported, such as enemy fire on enemy, or fire landing on a friendly unit that hasn't said so and that no crew is watching.
- **Ends:** A line ends on the track that holds the reported contact, so it follows the track as reports are merged. A contact not on any track is drawn at its own reported position.
- **Clutter:** Lines between the same two ends are one line, a crew's sight outranking a report. Lines up to `fireLineFreshSeconds` old show for everyone, and older ones up to `fireLineSeconds` only for the selected unit or track. Lines fade between the two.
- **In words:** A friendly unit's panel says whether it is under fire and since when, from whom, and what it is engaging. A track's panel says whom it is firing on and who is firing on it. Support request cards say the unit is under fire and from where. The track list can sort by tracks firing on friendly units.
- **No battle changes:** Units already knew they were under fire. This adds only what they believe about it, drawn on labeled random streams of its own, so every battle plays out as before. Ground units don't yet act on the direction of fire; returning fire on an estimate is a later step.

## 8. Aircraft simulation and orders

TICs can change air-tasking priorities, but deciding whether to divert an aircraft, keep supporting an engagement or return to base is the player's responsibility. Pilots retain autonomy for immediate defensive maneuvers; mission aborts and RTB are normally player decisions. The only automatic RTBs in v0.1 are the fuel rule in §8.2 and battle damage in §8.3.

Aircraft have ID, type, true and player-visible position, altitude, base, speed, fuel, ammunition, mission, damage state and sensor capability. Aircraft do not have independently simulated individual crew members yet. The airbase sits outside the map bounds, so aircraft positions can be off-map during transit.

Every aircraft is a real model, defined by data, and its role (recon or CAS) decides which orders it takes. Performance follows published figures where they matter to the game; see §8.5.

Player orders. Every task has a center and a radius, and the aircraft orbits the center no tighter than it can fly:

- `Watch(center, radius)`: be over the area. Recon searches it (§8.0). A strike aircraft circles and engages hostiles it finds there, as far as its weapons control allows.
- `Cover(platoon, radius)`: watch the ground ahead of a friendly platoon. The center follows the platoon's position on the controller's map, pushed `coverAheadMeters` along its reported heading.
- `Suppress(center, radius, until)`: gun runs on the area until the given time, with no target needed (§8.1.2). Strike aircraft only.
- `Strike(center, radius)`: one heavy pass on the center, then watch it. Strike aircraft only.
- `ReturnToBase`
- `SetAltitude(meters)` and `SetRisk(level)`, separate from the task, so they outlast it
- `SetWeapons(hold | bombs | guns | both)`: weapons control for the targets a crew picks itself, also separate from the task. Both is the default.

There used to be `MoveTo`, `Orbit`, `ReconArea` and `SupportArea`. They differed only in whether recon searched and whether a strike aircraft could fire, so they're now one Watch task plus weapons control: Orbit for a strike aircraft is Watch on Hold, and Support area is Watch with weapons free.

The map's right-click menu offers Suppress and Strike on the clicked place for each strike aircraft that can take an order, beside the points of interest. A friendly platoon's panel offers Cover with each strike aircraft.

Orders update missions; movement consumes simulated time and fuel. Aircraft can be retasked in flight, and aircraft launching from base incur a defined takeoff delay. Reconnaissance observes within a simplified footprint using air LOS and air concealment. Aircraft observations update the player's map automatically. Only a confirmed hostile that isn't already tracked from the air nearby generates a radio message, because the map already shows every sighting. Ground formations receive aircraft observations only when the player transmits them.

### 8.0 Crew autonomy

The controller decides what, where and how much risk, and the crew decides how. `decideCrew` runs every few seconds and reads only the crew's own contacts, the ground fire it has met, the forecast and the controller's map. It never reads truth.

- **Altitude:** The crew chooses its own: its working height, below cloud and within sight of the ground, low in transit for strike aircraft, and higher once recon has been shot at. Setting an altitude by hand overrides this until the controller hands it back.
- **Risk limit:** Set per aircraft, and it outlasts a mission. **Cautious** stays above every weapon it knows of and breaks off at any ground fire. **Normal** breaks off when hit or fired on by air defense. **Press on** never breaks off and will attack where it was shot at.
- **Breaking off:** The crew flies away from where it thinks the fire came from for `breakSeconds`, then returns to work.
- **Target choice:** Known air defense comes first. Otherwise a crew stays off places it was recently fired on, unless told to press on.
- **Attack runs:** A pass is a run: the crew flies at its aiming point, releases at `releaseMeters`, or the closer `gunReleaseMeters` for guns, then pulls off. It can be fired on the whole way in.
- **Weapons control:** Set per aircraft: **Hold**, **Bombs**, **Guns** or **Both**. It governs only the targets a crew picks itself under Watch or Cover. On Hold the crew picks none. Suppress and Strike are the controller's own call, so they fire whatever it says.
- **Keeping a position down:** On Guns, the crew spaces its bursts out over the time it can stay on station. Its job there is to keep heads down, not to kill.
- **Weapons:** Heavy ordnance does the most and goes first. Guns are many bursts that hit a small area and need a low run, which exposes the aircraft. They're used where friends are too close for heavy ordnance but outside `gunDangerCloseMeters`, and when heavy ordnance has run out.
- **Search:** Recon told to Watch flies a pattern over the area until it finds something, then stays to watch it, doubtful contacts first. A helicopter holds its position instead.
- **Never on its own:** A crew doesn't leave its area, forward a report, answer a ground unit or release inside danger close.

### 8.1 CAS engagement

CAS has three stages:

1. **Search:** The aircraft attempts to acquire a target within its assigned area using its own sensors. Its cue can come from player orders, existing intelligence or reconnaissance reports. A good reconnaissance cue can shorten the search, but it never makes a target visible automatically. If a report is stale or inaccurate, the aircraft may find nothing.
2. **Identify:** Identification may remain unknown or take time, and a crew can mistake friendly troops for hostile (§8.1.1). It never makes the opposite mistake.
3. **Engage:** An aircraft can attack only a contact it has identified as hostile. Unidentified contacts are never attacked.

Arriving at a reported TIC coordinate does not guarantee acquisition. Attacks are discrete passes. Each successful pass consumes ammunition and causes probabilistic suppression and casualties, modified by air cover and weapon characteristics, and can interrupt what the enemy formation was doing. Results flow through the shared ground-combat state rather than a scripted `support = success` flag. The player's click on a marker does not itself damage anything.

Contact position error and CAS search radius are tuned together, so that reconnaissance can make the difference between acquiring and missing a target.

The combat resolver prevents friendly-fire damage in v0.1. Aircraft report observed strike results automatically, never omniscient casualty counts.

### 8.1.1 Friendly fire and danger close

Strikes hit whoever is near the aiming point, on either side. Ground fire doesn't: a platoon's own fire on friends isn't simulated.

- **The rule:** A crew won't release heavy ordnance within `dangerCloseMeters`, or guns within `gunDangerCloseMeters`, of a friendly marker on the controller's map unless that unit has clearance. It holds, says so on the radio, and looks for another target. The check reads the map, so a stale marker is how a strike reaches friends who aren't where the map says.
- **What a unit asks for:** A support request names the weapons wanted and, if the unit knows one, a target. A unit asks for guns when it has to move past the enemy or the enemy is close, and for both otherwise. The controller may give something else.
- **Asking:** Only the ground unit can ask, because its commander is the one accepting the risk. A support request says danger close when the unit's own picture puts the enemy inside `radio.dangerCloseMeters`, and it can ask even after an earlier request was answered.
- **Clearing:** The controller approves or denies. Approval lasts `dangerCloseClearanceSeconds` and covers that unit only.
- **Mistaken identity:** A crew sometimes takes friendly troops for hostile, at `misidentifyChance`, more often at long range. The contact looks like any other, so the map check is the safeguard.
- **Check fire:** A unit hit by its own side's strike calls it in as urgent.
- **The map:** The controller's map is the reference for all of this. Aircraft sightings of friendly units update their markers directly, and only enemy reports go on tracks.

### 8.1.2 Fire missions: Suppress and Strike

Both fire on a place the controller chose, not on something the crew identified, so they need no target and can hit nothing. Each pass is resolved like any other, against whoever is truly near the aim.

- **Suppress:** Gun runs until the window closes or the guns are empty, then the aircraft watches the area. The crew spreads its bursts to last the window, never faster than its gun runs allow. It walks its fire across the area, out to `suppressSpreadShare` of the radius, and picks the next point in the walk that is clear of friendly platoons on the map. With no seen enemy to justify the risk, it keeps friends out of the whole reach of a gun pass, `gunSplashMeters × splashReach`, not just `gunDangerCloseMeters`, and holds if nowhere is clear. A platoon is one point on the map but its squads spread around it, which is why the margin matters.
- **Strike:** One heavy pass on the center, then the aircraft watches it. It keeps to `dangerCloseMeters`.
- **Risk:** Both follow the risk limit: unless told to press on, a crew stays off a place where it was seriously fired on.
- **Telling the ground:** When the controller orders a suppression, air operations announces it to every platoon it can reach, with the place and the times: from the aircraft's ETA until the end of the window. Giving the aircraft another task calls it off, which is also announced. Platoons know only what they were told, not whether the aircraft is really there. A platoon whose route runs past an announced suppression, or that is fired on from inside one, pushes through (§4.0.2).
- **Results:** The crew reports each pass as fire on an area, with the effect it saw. Nothing is credited to a contact.

### 8.1.3 Requests and marks

- **9-line requests:** A support request carries what a real 9-line does, as far as the platoon knows it:
  - where the enemy firing on it is,
  - how big it is,
  - whether the platoon will mark it,
  - and where the platoon itself is, the friendlies.

  The radio reads it in that order, and the request panel shows the target and the mark.
- **Smoke:** A friendly platoon that expects air marks the hostile it knows of nearest to it, within `markRangeMeters`. It expects air when its promised aircraft is due, or when a suppression has been announced.
  - The smoke is aimed at the platoon's own estimate, so a wrong estimate puts it in the wrong place, and it lands with an error of about `markErrorMeters`.
  - It lasts `markSeconds`, and a platoon marks again only after `markIntervalSeconds`.
- **Who sees it:**
  - A crew looking near smoke, within `markRadiusMeters`, spots targets `markDetectionBoost` times as readily and identifies them `markIdentifyBoost` times as readily.
  - A crew that can see smoke reports it, and it shows on the controller's map while it lasts.
  - The enemy sees it too: units near it know an air attack is coming and react as their doctrine says.

### 8.2 Fuel, turnaround and aircraft presence

Aircraft return to base automatically before fuel runs out. Refueling/rearming uses simple fixed turnaround timers, configurable per aircraft type.

Enemy ground units react to aircraft through their own AI, and only if they detect the aircraft. There is no automatic suppression aura around an orbiting aircraft: a formation that notices aircraft goes to ground briefly, then carries on, and won't take cover again for a doctrine-configured time unless it is actually attacked.

**Crew calls:** Each crew tells air operations when fuel and ordnance run low, once each per sortie:

| Call | When |
|---|---|
| JOKER | `jokerSeconds` of station time left |
| BINGO | Fuel for the trip home only; it heads home |
| Bombs expended | Heavy ordnance gone, with the gun bursts left |
| WINCHESTER | Nothing left to fire |

These give the controller time to plan a relief.

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

### 8.6 Weather

- **One plan per mission:** The whole mission's weather is generated once at the start, from the seed. It is a few storm systems, each with a path, size, cloud ceiling, rain strength and lifetime. They grow and fade over time. One wind moves them all, so the sky has a pattern a player can read, and weather at any point and time comes from that plan rather than being simulated tick by tick.
- **Visibility:** Weather acts through one figure, how far sight carries in meters, and it applies to ground observers, aircraft sensors, noticing, ground fire at aircraft and strikes. A sight line longer than the visibility fails. Shorter ones still suffer: an observer's reach falls smoothly as visibility drops, and spotting, position accuracy and identification all get worse with it.
- **Rain:** Strength matters, not just its presence. Visibility falls by the same share with each step of rain, from about 8 km in dry air to about 2 km in moderate rain and a few hundred meters in the heaviest. So an aircraft may have to come down to see or strike through heavy rain. Rain also adds to strike miss distance.
- **Cloud:** Visibility starts to fall about 200 m under the cloud base and is zero at it. An aircraft above the local ceiling and the ground can't see each other. Getting below the cloud can mean flying into reach of ground fire.
- **Forecast:** Forecasts reach the player as CECON updates at a configured interval. Each is a noisy copy of the plan, with small errors in position, ceiling and timing, and a wind error that grows with lead time. So near forecasts are good, far ones are rough, and a new one can change the picture.
- **Truth boundary:** The real weather is hidden. The player sees forecasts, and telemetry says when an aircraft is above cloud. A forecast covers weather only, and never shows future enemy positions.

### 8.7 Light, night and flares

Darkness is a shortage of light, and light is what lets anyone see and aim. The aircraft are 1960s types, so crews have no night-vision devices.

- **The sky:** Each scenario gives the mission's start time, sunrise, sunset, the moon's illumination and its rise and set. Twilight lasts `twilightSeconds` either side of sunrise and sunset. The light level is 1 by day. At night it is `starlight`, plus `fullMoonLight` times the moon's illumination while the moon is up, and heavy rain with its cloud takes away up to `cloudDimming` of it. The ephemeris comes with the weather forecast, so the controller knows it.
- **What light changes:** It works through visibility. An observer's reach to a target is cut by the square root of the light on that target, down to a twentieth, and a shorter reach is also a worse look, with poorer spotting, position and identification. A unit that is firing shows its muzzle flashes, so it can be seen at six tenths of daylight reach however dark it is: the reason to hold fire at night. Fire lands worse on men in the dark, down to three tenths of daylight effect, less so on men firing back. All of this applies to both sides.
- **Crews at night:** Where it is darker than `nightAttackLight`, a strike crew attacks only targets that are firing, and danger close distances are `darkDangerCloseFactor` times wider, because friends are harder to tell from enemies.
- **Flares from the air:** An aircraft carrying flares (each model has a load, restored at the airbase) can be told to Illuminate an area for some minutes, ordered from the map's right-click menu. The minutes count from when it gets there, as they do for Suppress. It keeps a flare burning over the area, dropping the next as the last one burns low, until the time is up or the flares run out, then watches the area. A flare lights `flareRadiusMeters` around it at `flareLight` for `flareBurnSeconds`: full across the middle, fading to the edge, and dimming as it burns out.
- **Illumination from the ground:** A platoon whose doctrine carries illumination rounds fires one, when it's dark, over the nearest enemy it knows of within `illuminationRangeMeters` that isn't already lit. These are smaller and shorter than an aircraft's flares, and fired no more often than every `illuminationIntervalSeconds`.
- **Light is for everyone:** A flare shows whoever is under it, on either side. Lighting up a fight exposes the friends in it as well as the enemy.
- **On the map:** The map darkens at night, as a reminder that light matters. Flares the controller knows of, those dropped by its aircraft or fired by its platoons, are drawn as light over the area while they burn. The header shows the light state, the moon and first light. No light field is drawn beyond that, because the controller has none.

### 8.8 Combat search and rescue

A downed aircrew evades on the ground while air operations finds it, protects it and sends a helicopter. The scenario is a race between the survivor's water, the hunters closing in, and the light.

- **The survivor:** A friendly platoon of one, with an Evade objective and radio discipline: it reports only when asked. It hides while an enemy it knows of is within its alert radius, and otherwise makes for its pickup point, or where it came down, around the nearest enemy it knows of. Air operations can send it a pickup point from the right-click menu; it makes for it when it judges it safe. Enemy positions forwarded to it are what keep it hidden.
- **Water and battery:** It starts with `waterSeconds` of water. When that's gone it moves at half speed, and after `thirstSeconds` more it dies. Its radio has `batteryCalls` transmissions. Each answer costs one and gives every hunter a direction-finding fix, `directionFindingErrorMeters` off, on where it came from. With the battery flat it says nothing. A SITREP from it carries the water and calls left.
- **Hunters:** Enemy platoons with a SearchArea objective start knowing where the parachute came down, within `sightingErrorMeters`. They close on the freshest lead they have and sweep around it. A hunter that has seen the survivor and comes within `captureMeters` takes it. A friendly SearchArea platoon runs the same search, and reaching the survivor brings it out.
- **The pickup:** Only a helicopter with seats can be given Pickup. It flies to the point, edges onto it at `landingSpeedMps`, and lands. A survivor within `boardCallMeters` runs for it; within `boardMeters` it boards, and boarding takes `boardSeconds` of the survivor beside it. Boarding is counted per second against a fixed minimum, so carrying casualties can reuse it. Once the survivor is aboard, the crew lifts off and flies home, and the rescue succeeds when it lands there.
- **On the ground:** A landed helicopter is `landedHitFactor` times easier to hit. Its crew lifts off under fire by its risk limit: cautious at any fire, normal when hit or under air defense fire, press on never. The controller can lift off at any time by giving it another order. Lifting off loses the boarding so far, and the survivor goes back to hiding.
- **Outcome:** Success when the survivor is home or linked up with friends; failure when it's captured or dead; partial at the deadline with it still missing.
- **On screen:** When a helicopter lands the game drops to normal speed, and a panel shows the boarding bar, the survivor coming, the fire taken and the escorts on station, with Lift off now one click away. At night the header offers Wait for first light, which runs the battle fast until dawn and stops for anything urgent from a unit or an aircraft, or a landing.

### 8.9 Medevac

A platoon with wounded asks for a helicopter, and every minute that helicopter sits on the ground saves more men and risks the aircraft. It reuses the landing and boarding of §8.8: casualties board as numbers instead of one survivor.

- **The request:** A platoon linked to air operations with at least `medevacMinWounded` wounded sends a MEDEVAC request, the essentials of a 9-line medevac request: how many wounded, the pickup point, and whether the enemy is near it. It asks again every `medevacRequestCooldownSeconds` while it still has wounded, unless air operations has answered within that time, yes or no. The request is urgent.
- **The pickup point:** The platoon chooses it from its own picture, never from the truth. It looks at points within `lzSearchMeters` of itself and picks the one that none of its known enemy contacts can see, furthest from the nearest of them, and then nearest to itself. With no enemy known, it is where the platoon is. It gives the point as it reckons its own position, error and all. The pickup is hot when the platoon is under fire or knows of an enemy within `ticRangeMeters` of the point.
- **Sending:** Only a helicopter with seats can be sent. The request card offers "Send" per helicopter with seats, and "No air available". Sending gives the helicopter Pickup at the pickup point and tells the platoon it is coming; a no tells it too. To land somewhere else, the controller gives the helicopter Pickup there from the map, as in §8.8.
- **Loading:** Once landed (§8.8), the helicopter takes wounded from every friendly squad within `loadReachMeters`, at `loadPerMinute`, counted per second. Fire slows it: while the helicopter or a squad loading it is under fire, loading runs at `loadUnderFireShare` of the rate. Loading takes the longest-waiting wounded first. It stops at the helicopter's seats.
- **Lifting off:** The crew lifts off and flies home when the seats are full, or when no wounded are left within reach. Fire makes it lift off by its risk limit, as in §8.8, keeping the wounded already aboard. The controller can lift off at any time, and the panel's Lift off now keeps those aboard too. A hit damages the helicopter and sends it home with whoever is aboard (invariant 10).
- **The enemy and the helicopter:** The enemy doesn't aim at a landed helicopter on purpose. It fires at it as at any aircraft, and a landed helicopter is already `landedHitFactor` times easier to hit.
- **The hospital:** The airbase counts as the hospital. Wounded aboard are evacuated when the helicopter lands there, and the time from wound to hospital is recorded for each.
- **Debrief:** For each side, killed, wounded, died of wounds, and wounded still waiting at the end; for friendly units, evacuated, still in the air on their way, and the mean time from wound to hospital.
- **On screen:** The request is a card like a support request, with the number of wounded, the pickup point and whether it is hot. The pickup panel shows wounded aboard against seats, and the wounded still within reach as the crew sees them.

## 9. Player interface

Desktop-browser layout:

1. **Main Canvas map:** Grid terrain, simple elevation/terrain tint, aircraft icons and paths, ground unit reported markers, enemy contact estimates at their last known positions, TIC flags, selectable reported positions.
2. **Radio panel:** Chronological message log with type/source/time; clickable reported coordinates; structured responses, report requests and contact forwarding.
3. **Selected aircraft panel:** Current mission, fuel, ammunition, available orders and target/area selection.
4. **Altitude profile and fleet list:** Airborne aircraft, plus the selected one, side by side on one altitude scale. Clicking a column selects that aircraft, dragging sets its target altitude in 100 m steps, and hovering shows its details. Lines mark the ceilings of weapons actually observed, so the profile never reveals a weapon the player hasn't seen. Beneath it, a scrolling list gives every aircraft one line with status, mission, altitude, fuel and ordnance, so the panel still works with many more aircraft.
5. **Global controls:** Pause, 1×/2×/4×/8× speed, current simulated time, objective and support-request list.

Interaction requirements:

- **The map key** is hidden until the player opens it with the Key button. It draws every symbol with the map's own code, on map paper, and says what each means: unit frames, icons and marks, size marks, condition and destroyed marks, and map features. It also explains the radio's brevity words and crew calls, the aircraft task codes, track numbers, Admiralty ratings, spot reports, 9-line requests and claims.
- The map always shows a north arrow and a scale bar that follows the zoom; north is always up, because the map doesn't rotate.
- **Unit symbols follow NATO APP-6 conventions**, drawn in a simple style of our own:
  - **Frame by side:** a blue rectangle is friendly, a red diamond hostile, a yellow quatrefoil unknown (unidentified). A low-confidence hostile is a **suspect**: a paler diamond marked "?". A dashed frame means not seen lately (§7.1), or for a friendly unit, gone quiet. Looked for and not found means no fill and "NOT FOUND".
  - **Icon inside:** a cross for infantry, an oval for vehicles, and a dome at the bottom for air defense.
  - **Size mark above:** ø team, • squad, •• section, ••• platoon, | company, from the strength estimate at its largest. Unknown strength has no mark. Symbols are all one size; the mark says how big.
  - **Losses:** (−) beside the size mark once losses are claimed, and an operational-condition bar under the symbol: green under a tenth of the estimated strength, yellow (neutralized) to three tenths, red (combat-ineffective) above (§7.2). The share is claims against claims plus the current estimate. A friendly unit's bar comes from its own last SITREP against its starting strength.
  - **Destroyed:** a solid ✕ when a crew reports it destroyed, a dashed ✕ when claims reach nine tenths of the estimate but nobody has seen it dead.
  - **Movement and facing:** an arrow from the bottom of the frame on a short staff when it's seen moving, and a short line the way a still squad faces.
  - **Text beside it:** weapons seen (`MG`, and `AAA` or `MP` in magenta), `×3` for a track built from three reports, and the time it was last seen once it is stale. A friendly symbol carries its designation.
- Aircraft are friendly blue silhouettes with a **data block**, as on an air controller's display: callsign, altitude and task, and what the crew says it's doing in brevity words (NO JOY, TALLY, IN HOT, DEFENDING, WINCHESTER and so on). The fleet list uses the same words.
- Contact reports read as **spot reports in SALUTE order**: size and unit, activity, location, time seen, equipment, then confidence. Each contact has an **Admiralty rating**: B for an aircraft or C for a ground report, then 1 if another source confirms it, otherwise 2, 3 or 4 by confidence.
- The Summary tab ends with an **air status board**: for each aircraft, its next hour as telemetry predicts it with no new order, in transit, on station, returning, rearming and ready. Hovering a bar gives the times.
- A Summary tab beside the radio gives a report-based picture: known enemy strength as a range, HQ's starting estimate, reported losses, what is unlocated, strength by sector, air threats, friendly status, the force ratio at the outpost and air activity. Its high end counts every report as a separate unit and its low end counts possible duplicates once, so good reconnaissance shows up as a narrower range. Everything comes from the `PlayerView`.
- When a run ends, the Summary tab adds a debrief comparing estimates with what really happened. This is the only time the player sees truth.
- The **Weather** layer can be switched on and off. It is drawn as a forecaster's chart: bands of cloud base, with red where the base is under the selected aircraft's altitude, and rain marks. Each storm has a track from now to where it dies out, with time marks, and a dashed likely path that widens with forecast error, so the player can see where it's coming from and when it arrives. A slider looks ahead up to the end of the mission and a button jumps to the selected aircraft's ETA. Far-ahead forecasts are drawn fainter, and the altitude profile shows the forecast cloud base.
- **The base map is drawn like a 1:50,000 topographic sheet.** Each kind of information keeps its own channel, so none hides another:
  - land cover is color: off-white open ground, green woods, darker green jungle, grey built-up,
  - relief is light and shade: light hillshading lit from the northwest, brown contours every 20 m with bolder labeled index contours every 100 m, and spot heights on summits,
  - roads and streams are smooth lines, not filled squares: roads red with a dark casing, streams blue,
  - a 1 km grid is labeled along the top and left in the same figures as grid references,
  - the weather layer and symbols sit on top.
- Selecting an aircraft shows **maximum elevation figures** as aviation charts print them: the highest ground in each grid square, rounded up to 10 m, in plain meters. Squares whose ground is above the aircraft's set altitude are outlined and lettered in red. Height uses no color, so it never competes with land cover or weather.
- Hovering the map shows the grid reference and elevation under the cursor, and nothing off the map.
- Selecting an aircraft shows a terrain profile along its path to its destination, with its altitude and any ridges in the way.
- The radio shows **Main** by default, with a switch to **All**. Messages are urgent (TIC, support request, ground fire), main (contact, SITREP, drill, strike result, command update) or routine (position, acknowledgement, the player's own forwards). A contact report counts as routine if it repeats a place heard from in the last `repeatContactSeconds` without a stronger estimate. Nothing is lost: **All** and the unit history show every message.
- Urgent and main messages also **pop over the map**, so the player needn't look away from it: at most four at once, one per sender, for 12 real seconds if urgent and 6 if main, held while paused. Clicking one centers the map on it and dismisses it.
- A unit or aircraft that has just been heard on the radio **blinks** on the map, red if the message was urgent.
- Nearby fresh hostile contacts are ringed as a **cluster**, with a count and a combined strength. A cluster is drawn only from the player's own reports. It claims no organization, a report of one large group never becomes invented squads, and a contact nobody has reported is never drawn.
- Contact markers show the weapons observed: nothing for small arms or none seen, a small `MG` tag for machine guns, and a magenta chevron with an `AAA` or `MP` tag for anti-aircraft weapons. Tags fade with the marker. A plain marker means weapons not observed, not that there are none, and a legend says so.
- Selecting an anti-aircraft contact shows a threat ring where the chance of a hit stays above a configured risk per minute, at the altitude of the most recently selected aircraft. It reflects the weapons observed and the last reported position, so it is an estimate, not a guarantee of safety outside it.
- Ground fire leaves a fading mark at the estimated source for a configured time, tagged with the weapon if the crew saw it. Marks close together merge into one, keeping the newest time and any hit or weapon reported. Marks show details on hover and aren't selectable.
- Click a radio coordinate → pan/center map on that **reported** coordinate.
- **Support request cards:** Each request is a card with what the unit asked for (target, size, mark, friendlies, weapons wanted), one button per strike aircraft that can go ("Send CAS-1 · ETA 14:05"), the reason for each one that can't (rearming until, returning, damaged, nothing left to fire), and "No air available". Sending tasks the aircraft over the unit and promises it in one action. A status line follows the answer: waiting, inbound with a live ETA, over them with the crew's brevity word, or called off if the aircraft was given something else. Answered cards stay ten minutes, and longer while the aircraft is still on its way.
- **Danger close:** The card offers Approve for 10 minutes or Deny. Once approved it shows "cleared until" with a Revoke button, and the unit's symbol carries "DC until" on the map.
- **Feedback:** Everything the controller sends is written into the radio log as its own transmission, with when a message reaches a unit, and shows briefly as a blue pop-over.
- **Aircraft panel:** The current task and what the crew is doing come first. Below them, the new task buttons (Watch, Cover, Suppress, Strike, Return to base), each with a tooltip; a task's own settings, such as radius and minutes, appear only once it's picked. Last come the standing settings, weapons, risk and altitude, each explained on hover. While a task waits for a place, a banner over the map says what it's for and that Esc cancels. Cover waits for a click on a friendly unit.
- **Right-click** offers what can be done where it lands. On a friendly unit: send support if it has an open request, or cover it, and ask for its position, a SITREP or a contact update. On a contact: its details and forwarding, and splitting a track. Anywhere: Watch, Suppress or Strike there for each aircraft that can take a task, and points of interest.
- **Shortcuts:** 1–9 select an aircraft, then W watch, C cover, S suppress, K strike, R return to base. Space pauses, Esc cancels or closes, T opens the timeline and ? the key.
- **Military time:** Each scenario has a local start time (`startTime`, 0600 by default), and every time shown is a 24-hour clock: 0632. The header shows the clock with seconds, the time since the start and, prominently, the time left.
- **Track list:** A Tracks tab beside Radio and Summary lists every enemy and unidentified track: number, what it is, weapons, condition, when last seen, rating and grid. It sorts by threat (air defense first, then units seen firing, then by side and size), by newest sighting, or by least damaged. Destroyed tracks go last. A row selects the track and centers the map on it.
- **Timeline:** Opened from the header or with T, during the run or after it. While it's open the battle pauses, and closing it returns to live and resumes. A slider runs over the battle so far, with every non-routine radio message marked along it, urgent ones in red. The map shows the battle as the controller knew it at that moment, from snapshots of the player's own view kept every 30 seconds. The radio messages within three minutes are listed, and clicking one jumps there and centers the map. Previous and Next step from event to event. After the run, a toggle adds where every squad really was at that moment, recorded by the session every 30 seconds and released only once the run is over, like the debrief.
- Select friendly ground marker → see its request, air cover, the reports it can be asked for, and what it said last; **no move/attack orders**.
- Select contact → see its details, choose recipients, review the transmission preview and transmit.
- Marker tooltip displays source, observation time, identification, confidence/strength category and whether the position is reported or aircraft-observed.
- Map never gives hidden enemy identities, true positions, or actual ground casualties that the player has not learned.

No textures, animation system or sound are required.

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

**Deciding uses estimates, resolving uses truth.** Everything that chooses what to do reads only a unit's or crew's own picture: where to move, where to shoot, whether to shoot, which drill to run, what to report. Truth is read only to work out what happens: who a shot hits, who sees what, and what an estimate comes out as. Forwarded reports carry the crew's estimate unchanged, errors included.

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

### 11.1 Scenario files

The engine doesn't assume the outpost. A scenario is a file naming its map, units, aircraft, time limit and mission, and it can be chosen with `npm run sim -- --scenario name` or `?scenario=name` in the browser.

- **Shared rules:** Doctrines, weapons, perception, radio and aircraft models live in one rules file, so tuning stays in one place. A scenario can replace any single value.
- **Missions:** Each has an area, a briefing, and result text for success, partial success and failure. Holding an area and getting named units to an area are the first two kinds. A mission is shaped like a future incident: a place, what it needs, and how it can end.
- **Hidden threats:** A briefing and its results state the mission only. They never name a threat or say what to do about it, which is for the player to discover through recon.
- **Policies:** Each scenario has its own scripted test policies. Like the player, they read only the `PlayerView`.
- **Terrain:** Each map has a recipe that writes its layers, so a stored map can be rebuilt exactly. Maps can differ in size, but stay square.
- **Aircraft:** A scenario lists its aircraft by model, and can give one a different bomb load than its model's usual.

The scenarios so far:

| Scenario | What it asks | What it tests |
|---|---|---|
| Outpost Under Pressure | Hold the outpost for 75 minutes | Recon, CAS and forwarding against a deliberate assault |
| Valley Road | Get a column through a valley with ambushes beside the road | Route recon, kill zones, drills and danger close |
| Overwatch | The same valley, with three strong positions set back on the slopes and an air defense team; the strike aircraft carries two bombs | Whether guns and suppression matter where bombs are scarce and the enemy is out of danger-close range |
| Find Them | Locate an infiltrating force | Recon alone, scored on how close the picture was |

## 12. Testing and acceptance criteria

### Domain/unit tests

- Two opposing units use the same behavior/combat functions with different inputs and get symmetric rule treatment.
- A ground unit without a detection does not generate a contact estimate for a hidden opponent.
- Contact position/strength estimates remain unchanged until a genuinely new observation or estimation revision.
- A repeated position report carries the persistent navigation estimate, not a fresh independent error.
- Ground and airborne concealment affect detection; ground and air cover affect damage, separately.
- Radio task progress slows or pauses under suppression, while ordinary engaging need not stop reporting.
- Message contents never use true enemy coordinates or strength unless actually measured at sufficient accuracy.
- Marker opacity never drops below the configured floor; a stale marker stays at its reported point and uses only received observations and elapsed time.
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
- Weather comes from one plan fixed at the start, moves as a pattern, and replays exactly.
- Cloud blocks sensing, noticing, ground fire and strikes for aircraft above it, and visibility falls smoothly approaching the base.
- Stronger rain always means shorter visibility, for ground observers and aircraft alike.
- Forecast error grows with lead time, and the view holds forecasts, never the true weather.
- Tracks change the map, never the stored reports.
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
| **M7.9: Weather** | Storm systems, cloud and rain effects, imperfect forecasts, map layers and a forecast slider | Does weather change when and how aircraft are sent? |
| **M8: Squads** | Skipped for now: subordinate elements, grouped markers, covering fire and maneuver | Does squad detail matter from the player's seat? |
| **M9: Calibration** | Reproducible policy testing, tuning, usability refinements, documentation of known simplifications and tuning values | Are the success-rate and information-value targets satisfied? |

Calibration starts in M1 and continues throughout development; M9 is final tuning, not the first check of whether the game is viable.

## 14. Definition of done

v0.1 is complete when a player can load the initial scenario, receive a self-reported TIC from an autonomous ground formation, click its imperfect reported coordinates, task an aircraft via the map, obtain better information from reconnaissance, optionally forward that information to selected friendly ground units, and measurably influence the autonomous battle. Fuel, ammunition and time constrain the decisions. The map shows uncertainty rather than hidden truth. A reproducible headless test suite demonstrates that the initial scenario needs effective air intervention and that choosing how to intervene matters.
