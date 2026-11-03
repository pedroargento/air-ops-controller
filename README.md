# Air Operations

You are the air operations controller in 1960s Southeast Asia. Your job is the aircraft, not the troops. Platoons on the ground fight their own battle. They report what they see and ask you for help, and you decide where to send a handful of slow aircraft with little fuel and fewer bombs.

What you have is reports. They arrive late, they are often wrong, and they contradict each other. The map shows what air operations believes, not what is there. The game is about building a picture from radio traffic, deciding with what you know, and living with the result. The truth is shown only in the debrief.

The design follows real doctrine where it can: NATO map symbols (APP-6), SALUTE spot reports, 9-line support requests, brevity words (JOKER, BINGO, WINCHESTER), track numbers and source ratings, danger close, and military time.

## Running it

You need Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open the address Vite prints, usually <http://localhost:5173>, and pick a scenario from the menu.

The URL records what you are playing, so you can bookmark or share a battle:

| URL | What it does |
|---|---|
| `/` | The scenario menu |
| `/?scenario=valley-road` | Plays a scenario with a random seed |
| `/?scenario=valley-road&seed=42` | Plays the same battle every time |
| `/?scenario=valley-road&seed=42&speed=8` | Starts at a higher speed |

For a static build, `npm run build` writes the game to `dist/`.

## Scenarios

| Scenario | Time | What you do |
|---|---|---|
| **Outpost Under Pressure** | Dawn, 75 min | Hold an outpost against a heavy attack. The first scenario to play. |
| **Downed Pilot (introduction)** | Dusk, up to 16 h | Find a downed pilot, keep the pilot hidden, cover the helicopter and bring the pilot home. Headquarters messages guide you through the steps. |
| **Find Them** | Day, 60 min | Two spotter aircraft and an hour to find a force that has gone to ground. Recon only. |
| **Outpost at Night** | Night, 75 min | The same outpost, attacked in the dark before first light. Flares light the fight for both sides. |
| **Valley Road** | Day, 2 h | Get a column up a valley road where the enemy is expected. Scout ahead and support it. |
| **Overwatch** | Day, 2 h | The same road, with the enemy dug in on the slopes and only two bombs. Choose where to use them. |

## How to play

### The screen

- **Map:** a topographic map with a 1 km grid. Your units and the enemy are drawn with NATO symbols: blue rectangles are friendly and red diamonds are hostile. The symbol shows the size (●●● is a platoon) and the type (an X for infantry). A solid outline is a fresh report, a dashed one is stale, and the small arrow is the last seen direction of movement. Press **?** or the **Key** button for the full key, which covers every symbol and brevity word.
- **Header:** mission time, speed, pause, the light and weather, the objective, the **Timeline**, **Scenarios** and **Export log** buttons.
- **Sidebar, from the top:**
  - **Aircraft:** each aircraft with its status, task, altitude, fuel and ordnance.
  - **Units on the net:** every unit you can reach by radio, including units you have never seen.
  - **Support requests:** units asking for air.
  - **Selected:** details and actions for whatever you have clicked.
  - **Radio / Tracks / Summary:** the radio log, the list of tracked enemy groups, and a summary of the battle.

### Giving orders

Most orders come from **right-clicking on the map**. The menu offers what makes sense at that spot:

- **Watch** sends an aircraft over an area. A recon aircraft searches it, and a strike aircraft engages what it finds, within the weapons control you set.
- **Cover** keeps an aircraft over a friendly platoon and follows it.
- **Suppress** has an aircraft strafe an area with guns until a set time.
- **Strike** makes one bombing pass on a point, after which the aircraft watches it.
- **Illuminate** keeps flares burning over an area at night, if the aircraft carries flares.
- **Pick up here** lands a rescue helicopter at the point and waits while survivors board.
- **Mark this place** warns chosen units of a suspected kill zone there, so they go around it.

Select an aircraft to set its **weapons control** (bombs, guns or both, or weapons hold), its **risk limit** (cautious, normal or press on, which decides when the crew breaks away from ground fire), and **Return to base**.

**Support requests** arrive as cards. Answer one by sending an aircraft, or say that no air is available. A unit that gets no answer fights on without air. When friends are too close to a target, the crew asks for **danger close**, and only you can clear it.

**Forwarding** is how you help the ground. Select an enemy contact or track and forward it to the units that should know about it. Units act on what they know, so a platoon warned about an ambush can avoid it.

### Keyboard

| Key | Action |
|---|---|
| Space | Pause and resume |
| 1–9 | Select an aircraft |
| W / C / S / K | Start a Watch, Cover, Suppress or Strike order for the selected aircraft, then click the map |
| R | Return the selected aircraft to base |
| T | Open the timeline |
| ? | Show or hide the key |
| Esc | Cancel |

### Things worth knowing

- **Reports age.** A contact seen ten minutes ago has moved. Work out yourself where it might have gone.
- **Units overclaim.** Casualty claims from a fight usually run high. The track's condition bar deconflicts them, and the debrief shows the truth.
- **Fuel and bombs set the tempo.** JOKER means about ten minutes are left, and BINGO means the aircraft is heading home now. Rearming takes time, so plan reliefs.
- **Ground fire is real.** Low and slow is easy to hit, and anti-aircraft guns and missiles reach higher. A damaged aircraft goes home.
- **Night changes everything.** Everyone sees less, and units that are firing show their muzzle flashes. Strike crews attack only targets that are lit or firing. Flares light friends as well as enemies. At night the header offers **Wait for first light**, which fast-forwards the battle and stops for anything urgent.
- **Rescue takes focus.** A downed pilot stays silent to save battery, and each call can give the pilot's position away. Find the pilot through **Units on the net**. When the helicopter lands, the game drops to normal speed and a panel shows boarding progress, with **Lift off now** one click away.
- **The timeline** (T) replays the battle as you knew it. After the run, it also shows where everyone really was.

## For developers

```sh
npm run check     # typecheck, lint and all unit and integration tests
npm run e2e       # browser check of the whole game in Chromium (add --screenshots dir to keep pictures)
npm run params    # regenerate docs/parameters.md from the rules
```

### Simulating many battles

The simulation is deterministic and runs without a browser. Bots (*policies*) play the controller's role so that scenarios can be measured and balanced:

```sh
npx tsx src/cli/batch.ts --scenario valley-road --policy all --seeds 200
npx tsx src/cli/batch.ts --scenario downed-pilot --policy rescueNow --seeds 200
npx tsx src/cli/batch.ts --scenario outpost-under-pressure --policy informed --seeds 300 \
  --set doctrines.hunter.speedMps=0.8 --json out.json
```

`--set` overrides any rule from `scenarios/rules/standard.json` for that run. The bots for each scenario are listed in `src/cli/policy-registry.ts`.

### Layout

| Path | Contents |
|---|---|
| `src/sim` | The simulation step: movement, fire, air, radio, flares, rescue. Works on the truth. |
| `src/ai` | Ground units' decisions, made from their own knowledge only. |
| `src/perception`, `src/knowledge` | What each unit, and air operations, comes to believe. |
| `src/policies` | Bots that play the controller. |
| `src/ui` | The browser interface. It sees only the player's view, never the truth. |
| `src/play.ts`, `src/main.ts` | The game page and the entry point with the scenario menu. |
| `scenarios/` | Scenario files, their terrain layers, and the shared rules in `rules/standard.json`. |
| `debug.html` | An omniscient view for debugging. It is never linked from the game. |

Two rules hold the design together. The interface, the bots and the ground AI never read the truth, and lint and tests enforce this. And a seed plus the command log always replays to the same state hash, which is what the **Export log** button saves.

### Documents

- `air-operations-v0.1-spec.md` is the design: the rules of every system, with section numbers referenced in the code (§8.7 is night, §8.8 is rescue).
- `implementation-plan.md` covers milestones, the roadmap and balance measurements.
- `docs/parameters.md` lists every tunable rule with its value and meaning.

### Adding a scenario

Copy a file in `scenarios/` and give it its own `id`, `name`, `summary`, mission, units and aircraft. It appears in the menu automatically. Add bots for it in `src/cli/policy-registry.ts` so it can be measured. The scenario tests check that every file loads in both the browser and the command line.
