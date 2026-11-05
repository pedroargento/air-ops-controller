# Changelog

Notable changes to Air Operations. Section numbers such as §8.8 refer to `air-operations-v0.1-spec.md`, and balance figures are in `implementation-plan.md`.

## Unreleased

### Wounded and medevac (§4.1.1, §8.9)
- Casualties are now killed or wounded. Wounded stay with their squad, tie down men to carry them, slow it, and die as they wait; a platoon on the move with too few men free to fight holds for them. The same rules hold for the enemy, which has no medevac.
- Platoons with wounded send a MEDEVAC request with the number of wounded, a pickup point out of the enemy's sight, and whether it is hot. Answer it from its card with any helicopter with seats, or say no air is available.
- A UH-1H Dustoff joins Outpost Under Pressure. Landed, it loads wounded a few a minute, slower under fire, up to six, then flies them to the hospital at base. The pickup panel shows them coming aboard.
- The debrief gives each side's killed, wounded and died of wounds, and your evacuated and time to hospital. Over 300 outpost battles, medevac roughly halves deaths from wounds and gets the Dustoff hit about one run in three. The road maps are a few points harder, because columns carry their wounded.

### Fire on the ground (§7.3)
- The map shows who is firing at whom, as far as crews saw it or units reported it: solid arrows for fire a crew saw, dashed arrows for fire a unit reported, a pale wedge for fire from a shooter the unit can't see, and a short stub for fire whose target no crew could see. Red is enemy fire, blue is friendly.
- UNDER FIRE and HEAVY FIRE beside friendly units that say so, or that a crew sees being fired on.
- Unit and track panels say who is firing on whom and since when, support request cards say where the fire comes from, and the track list can sort by tracks firing on friendly units.
- Units carry this in the reports they already send, so the radio gets no busier, and every battle plays out exactly as before.

### React to contact (§4.0.3)
- Ground units on both sides now answer fire: they target the enemy shooting at them rather than the nearest one, fire back toward fire from a shooter they can't see, and look that way to find it. Units holding ground stay put; units on the move keep going while they fire.
- Battles change: the outpost with good air work rises from 66% to 74% won, columns warned of nothing do better on Valley Road, and Overwatch is about 5 points easier. Every scenario keeps its spread from no air to good air.

## 0.2.0 (2026-11-03)

Six scenarios, squads and drills on the ground, crews that fly their own missions, NATO map conventions, tracks, night, and combat search and rescue.

### Scenarios and menu
- A scenario menu opens on a bare URL. Each scenario has a card with its objective, briefing, time of day, length and aircraft, plus an optional seed. `?scenario=` and `?seed=` URLs still play directly.
- Shared rules in `scenarios/rules/standard.json`, with HoldArea, ReachArea, LocateForce and Rescue missions.
- New scenarios: **Valley Road**, **Find Them**, **Overwatch**, **Outpost at Night** and **Downed Pilot (introduction)**.
- Scenarios can give an aircraft its own bomb load, and can keep an aircraft unready for a set time after the start.

### Ground war
- Ground tactics, with morale kept separate from suppression and losses, and enemy units with different roles.
- Platoons split into squads. A platoon keeps one ID for the radio and orders, and one shared picture.
- Six battle drills defined as data, assault and ambush objectives, orders triggered by time, completion or contact, a hidden posture and rally points.
- Weapon inventories, with combat that depends on equipment, and a hidden air defense team.
- Points of interest: mark a suspected kill zone for chosen units, and they watch that ground and go around it.
- Platoons wait for air only when it's worth it: the position is strong, there's time, air hasn't said no, and they can wait unseen.
- Evading and searching behaviors for a downed aircrew and the units hunting it (§8.8).

### Aircraft and crews
- Real Vietnam-era models: O-1E, RF-101C, A-1E, F-100D, UH-1B, AH-1G, OH-6A and HH-3E, each with its own speed, endurance, ordnance, armor and accuracy. Helicopters hold position and fly close to the terrain.
- Crews fly their own missions (§8.0): they choose an altitude, break off from ground fire within the risk limit you set, fly attack runs and search their area.
- Tasks: Watch, Cover, Suppress, Strike, Illuminate, Pickup and Return to base, with weapons control (bombs, guns, both or hold) for each aircraft.
- Friendly fire and danger close, which you clear when a ground unit asks.
- Crew calls: JOKER, BINGO, BOMBS EXPENDED, WINCHESTER, WHEELS DOWN, LIFTING OFF and SURVIVOR ABOARD.
- Damage forces an aircraft to return to base. Terrain blocks sensors, ground fire and strikes.

### Weather and light
- Storms, cloud and rain from a seeded plan, with imperfect forecasts. A single visibility figure drives sighting and fire, and a forecaster's chart can be drawn on the map.
- Light from the sun, the moon and cloud (§8.7). In the dark everyone sees and aims worse, except at units showing muzzle flashes, and strike crews attack only targets that are lit or firing.
- Flares from aircraft, ordered from the right-click menu, and illumination rounds from the ground. Both light friends as well as enemies.
- **Wait for first light** fast-forwards the night and stops for anything urgent.

### Search and rescue (§8.8)
- A downed pilot evades with limited water and a survival radio. Every call drains the battery and gives the hunters a direction-finding fix.
- Hunters start from where the parachute was seen, close on their leads and capture the pilot only once they have seen the pilot.
- **Pick up here**: the helicopter lands, and boarding takes a fixed time, counted per second. Landing drops the game to 1× and opens a pickup panel with **Lift off now**.

### What air operations knows
- Reports are correlated into numbered tracks. Each part of a track comes from its best source, with weighted positions and a merge pass.
- Ground units claim casualties. The map deconflicts the claims, and the debrief compares them with the truth and rates each source from A to E.
- 9-line support requests, smoke marks, SALUTE spot reports and Admiralty ratings.
- Radio triage into urgent, main and routine, with a Main/All filter.

### Map and interface
- NATO (APP-6-style) unit symbols, with size marks, an operational-condition bar, destroyed marks and movement arrows. Stale contacts are drawn dashed at their last known position.
- A topographic base in the style of a 1:50,000 map: land cover, hillshading, contours, spot heights, roads, streams, a 1 km grid and maximum elevation figures.
- A full map key with the real symbols and every brevity word.
- Controls overhaul:
  - request cards with one-click support and their status,
  - danger close state with revoke,
  - a log of outgoing messages,
  - a context menu on right-click,
  - keyboard shortcuts.
- Sidebar and timeline:
  - **Units on the net** lists every unit you can call, including ones never seen,
  - a track list, an air status board, military time,
  - a timeline that shows the truth after the run.
- An altitude profile, a path profile, a battle summary and an end-of-run debrief.
- Removed: the threat overlay, and the uncertainty circles and cones.

### Tooling
- `npm run params` generates `docs/parameters.md` from the rules, and every rule is described.
- `batch --set path=value` overrides rules for one run, and every scenario has its own bots.
- A README covering the game, how to play and how to run it.
- An illustrated controller's manual in the style of a 1990s game booklet, with period photographs of every aircraft. The PDF is attached to the release, and `npm run manual` rebuilds it.

## 0.1.0

The first playable version, through milestone M4: a deterministic simulation (ground AI, perception, combat, radio, air operations), the player's knowledge and view, bots and batch tooling, a debug replay page, and the canvas interface for Outpost Under Pressure, with unit, integration and browser tests.
