# Air Operations — Design Principles

This is the context a new developer or agent needs before changing the game. It covers what the game is for, the rules that must not break, and the decisions already made, with the reasons for them. The rules of each system are in `air-operations-v0.1-spec.md`, and build order, results and the roadmap are in `implementation-plan.md`.

## The game in one paragraph

You are the air operations controller in 1960s Southeast Asia, and later in a fictional, Afghanistan-like country with the same Vietnam-era aircraft. Ground units on both sides fight their own battle. They report what they see and ask for help, and you decide where a handful of slow aircraft with little fuel and fewer bombs will do the most good. You never move a soldier. You see only reports, which are late, often wrong and sometimes contradictory, and the truth is shown only in the debrief.

## Philosophy

1. **The controller, not the commander.** The player's levers are aircraft, information and answers to requests. Every feature should give the player a decision about those levers, never a way around them.
2. **The game is about information.** The interesting work is building a picture from reports and weighing it against what the aircraft can do. The player is a detective with a budget. If the player can see the truth, that work disappears.
3. **Scarcity is the engine.** Aircraft, fuel, bombs, flares, seats, daylight, turnaround time and the player's attention are all limited. A choice is only interesting when saying yes to one thing means saying no to another.
4. **Outcomes emerge, not scripts.** A scenario sets places, units, objectives and doctrine, and the simulation produces the fight. Requests come from units that need air, not from a timeline. Timed orders are allowed, but nothing depends on the player doing the expected thing at the expected time.
5. **Discovered, not briefed.** A scenario states the mission only. Threats such as a reaction force or a hidden air defense team are for the player to find by scouting. Recon must visibly pay off.
6. **Crews are professionals.** The controller decides what, where and how much risk. The crew decides how: altitude, attack runs, breaking off, searching. The roadmap moves further this way (mission orders, M10), so new air features should give crews judgment, not give the player more knobs to fly.
7. **Real doctrine where it serves a decision.** Map symbols (APP-6), SALUTE spot reports, 9-line requests, brevity words, Admiralty ratings, NATO condition thresholds, danger close, military time and FM 7-8 battle drills are used because they compress information the way the real job does. Realism stops where it adds bookkeeping without a decision: casualties are numbers, not individuals, and radio procedure is text, not voice.
8. **Teach through play.** Tutorials are ordinary scenarios with headquarters (CECON) messages, not separate modes. The map key, hover help and the manual explain conventions instead of hiding them.
9. **Allocation, not speed.** The game pauses, and every order can be given while paused. Difficulty comes from what to do, never from how fast the player clicks. The game slows down for moments that need attention, such as a landing, and offers to fast-forward quiet ones, such as waiting for first light.
10. **Measure, then believe.** A rule earns its place by changing results in batch runs with bots. When it doesn't, the plan says so plainly rather than tuning until it seems to. Guns are the standing example: measured repeatedly, they don't yet change outcomes, and that is recorded, not hidden.

## Invariants

These hold in every change. Breaking one needs an explicit decision recorded below and in the spec.

1. **Same rules for both sides.** Both sides use the same ground AI, drills, radio and combat rules. Objectives, doctrine, links, knowledge and equipment can differ. No rule checks a faction, and a unit's abilities come from its equipment and men, never from a hardcoded class. A drill such as an assault works for either side on any map.
2. **No direct ground control.** The player can forward intelligence, answer requests, clear danger close, mark places and ask for reports. The player can't order a ground unit to move or attack.
3. **Deciding uses estimates, resolving uses truth.** Anything that chooses what to do reads only its own picture: ground AI, crews, bots and the interface. Truth is read only to work out what happens: who a shot hits, who sees what, and what an estimate comes out as. Forwarded reports keep their errors. Lint import rules (`eslint.config.js`) and the boundary tests (`tests/integration/truth-boundary.test.ts`, `knowledge-boundary.test.ts`) enforce this. The debug view (`debug.html`) is the only exception, and the game never links to it.
4. **The player's map is a pure view of player knowledge.** Grouping symbols, aggregating tracks or zooming never invents what hasn't been reported. A platoon-sized report never turns into invented squads.
5. **Deterministic replay.** A scenario, seed and tick-stamped command log reproduce the same state hash on any build of the same version. Simulation code uses labeled RNG streams (`detect/<observer>/<target>`, `df/<unit>`), `det-math.ts` instead of `Math.log` and similar functions, and never `Math.random`, `Date.now` or `performance.now`. Lint bans them. The golden hash in `tests/integration/replay.test.ts` changes only as a deliberate part of a rule change.
6. **One simulation core.** The browser, the batch runner, the bots and the tests all drive the same `step()`. No gameplay rule lives in the interface.
7. **Reliable air telemetry.** The player always knows where friendly aircraft are, their altitude, task, fuel, ordnance and damage. The fog is over the ground, not over your own aircraft.
8. **Radio costs time.** Reports take simulated time to send, units choose when to report, and the player's calls go out as transmissions in the log. Information from aircraft reaches ground units only when the player forwards it.
9. **Air matters, but doesn't win alone.** In every scenario, no air does badly and good air work does clearly better than lazy air work. No scenario relies on a scripted invulnerability or a free win.
10. **A hit damages, never destroys.** Ground fire that gets through ends the aircraft's mission and sends it home for repair. No aircraft is shot down yet. Changing this is a listed candidate and a major decision, because it turns every scenario into a possible rescue.
11. **Rules are data.** Every tunable value lives in `scenarios/rules/standard.json` with a description, and `npm run params` regenerates `docs/parameters.md` from it. Scenarios are JSON files validated by the Zod schema. A new value with no description fails the tests.
12. **Changes don't move battles by accident.** A feature that isn't meant to change existing battles must leave every scenario and bot result identical over a sample of seeds. A feature that is meant to change them is measured, and the new figures go in the plan.

## Decisions

Newest first. Each says what was decided and why, so it isn't reopened by accident. Dates are when the decision was made.

| Date | Decision | Why |
|---|---|---|
| 2026-11-05 | **Every unit reacts to fire** (§4.0.3): it answers the shooter, fires back toward unseen fire, and looks that way. No scenario was retuned. | Playtest: units seemed to stand still under fire. Both sides use it, it is a doctrine switch so its value can be measured, and every scenario stayed in range (the outpost's good air rose from 66% to 74%). |
| 2026-11-04 | **The map shows fire only as far as someone saw it or said it** (§7.3): solid arrows for what crews saw, dashed for what units reported, wedges for fire from a shooter nobody saw. It rides on existing reports, so no battle changes. | Playtest: with no sign of who was fighting whom, the controller couldn't choose what to hit first. Showing the truth would end the detective work, so the display follows the same evidence rules as contacts. |
| 2026-11-04 | **S7, wounded and medevac, comes next,** then Compound support with medevac in it. | It reuses the landing and boarding built for rescue, gives every battle a casualty clock, and medevac is a core incident in the theater game. |
| 2026-11-04 | The PDF manual stays out of git and is attached to releases. Its source, photos and fonts are in `docs/manual/`. | Keeps a 7 MB binary out of history. Photos are public domain (US government) and fonts are open licensed. |
| 2026-11-03 | **A downed pilot can be called without being seen.** "Units on the net" lists every unit on the radio net, including ones never on the map. | Playtest: the controller had to scout blind and lost an aircraft just to ask a question the radio should answer. |
| 2026-11-03 | **Downed Pilot is kept as an introduction**, although an escorted rescue succeeds 98.5% of the time. A harder rescue is planned. | An easy, guided scenario is the right way to teach rescue. Making it hard and teaching it are separate jobs. |
| 2026-11-03 | **A bare URL shows a scenario menu**, and `?scenario=` and `?seed=` still play directly. | URLs make battles shareable and replayable, and a menu makes them discoverable. No router or save system is needed yet. |
| 2026-11-03 | Night is balanced by the **scenario's hours** (moonset, first light), not by softer night rules. | A first version with gentler rules was unwinnable anyway. Night favors the attacker, which is the point. |
| 2026-11-03 | Units **wait for air only when it's worth it** (strong position, time, unseen, air hasn't said no). The column doctrine keeps waiting off. | Always waiting cost about 7 points. The weighed rule removes the loss, but it shows no gain yet. |
| 2026-11-03 | **Guns are left unbalanced on purpose** (S3 open). | Measured on every map, including one built for them, guns are a fallback when bombs run out, not a weapon that changes outcomes. Forcing a role would mean tuning against the evidence. |
| 2026-11-03 | **Uncertainty circles, cones and the threat overlay were removed.** A contact not seen for two minutes is drawn dashed at its last known position with the time, and where it went is the player's call. | Drawn uncertainty did the player's thinking. Real maps show last known positions and times. |
| 2026-11-02 | **Crews fly their own missions.** Bots and the player assign tasks, weapons control and a risk limit, never altitude or attack geometry (altitude can still be set by hand). | The controller's job is allocation. The bots' flying logic moved into the crews with no loss of results. |
| 2026-11-02 | **Strikes can hit friends,** and only the controller can clear danger close. Bots deny it by default. | Without friendly fire, air near troops is free and danger close is meaningless. |
| 2026-11-01 | **Squads are the simulated unit and platoons are command** (S1). Only platoons talk to air operations. | Battle drills need squads, and the player's radio must not grow with the unit count. |
| 2026-11-01 | **Scenarios before the theater.** Build standalone scenarios (S0–S8), then a one-site theater (M11), then a two-site slice (M12) as a go/no-go gate. | Scenarios give playable missions sooner, test the ground AI on new maps, and become incident templates later. M12 asks whether juggling two fights is fun before building more. |
| 2026-11-01 | **Objectives are written as incidents:** a place, a time window, what it needs, and what happens if nobody comes. | That's the shape of the theater game's random requests, so each scenario is also a template. |
| 2026-10-31 | **The theater direction:** a slice of a fictional, Afghanistan-like country about 200 km across, several bases, continuous play over days with no win condition, random ops requests (troops in contact, recon, medevac, QRF, rescue), crew rotation, and more crew autonomy. Today's aircraft stay, with no drones or satellites. | The game is resource management. The detective work survives as weighing troop reports against resources. Without drones or satellites, the information problem stays hard. |
| 2026-10-31 | **Outpost fine tuning waits for M13.** | The theater changes what is measured (requests served, response times, losses), so tuning win rates now would be wasted. |
| 2026-10-31 | **Real aircraft models**, with role separate from model. | Real types bring real tradeoffs (speed, endurance, armor, load) without inventing them. |
| 2026-10-31 | The **aircraft aura was removed** (M7): an aircraft overhead no longer pins every formation near it. | Most of air's value came from the aura, not from what aircraft did. Air must earn its value through real effects. |
| 2026-10-30 | **Headless first,** with a deterministic simulation, bots and batch runs before the interface. | The main risk was whether the battle could be balanced at all, which only batch runs can answer. |

## How to work on it

- **Before changing a rule,** run the bots for the affected scenarios (`npx tsx src/cli/batch.ts --scenario <name> --policy all --seeds 300`), make the change, and run them again. Report paired differences, not single runs. A change meant to be neutral should give identical results.
- **New tunable values** go in `scenarios/rules/standard.json` with a description. Run `npm run params` afterwards.
- **A new scenario** needs bots in `src/cli/policy-registry.ts`, so it can be measured, and its own measured spread from no air to good air.
- **A new rule** gets a spec section first (each roadmap milestone needs one before it starts), then the code, then a result paragraph in the plan with the figures, and a line in `CHANGELOG.md`.
- **Checks:** `npm run check` (types, lint, unit and integration tests) must pass. Run `npm run e2e` for anything the interface touches.
- **Playtests decide what bots can't.** Is it fun, is it clear, is it too easy? Write the findings in the plan, and treat a playtest complaint about missing information (like the unseen pilot) as a design bug, not a skill issue.
- **Writing:** documents and in-game text use plain, short sentences, define a term before using it, and give figures with their sample size.
