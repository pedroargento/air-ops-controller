import { GAME_SPEEDS, parseSeed, parseSpeed } from './game/url-options';
import { isAntiAir, threatRadiusMeters } from './domain/public/equipment';
import { AIR_OPS } from './domain/public/radio';
import { attentionKeys, needsAttention, radioNeedsAttention } from './game/attention';
import { clearSave, readSave, resumeGame, saveGame, type SaveStore } from './game/autosave';
import { nextFirstLight } from './domain/public/light';
import { GameSession } from './game/session';
import { DEFAULT_SCENARIO_NAME, loadBundledScenario } from './scenario/catalog';
import { App } from './ui/app';
import { setMissionStart } from './ui/format';

const SPEEDS = GAME_SPEEDS;
const MAX_TICKS_PER_FRAME = 20;

const search = new URLSearchParams(location.search);
const scenario = loadBundledScenario(search.get('scenario') ?? DEFAULT_SCENARIO_NAME);
document.body.classList.add('playing');
const { mission } = scenario.file;
document.title = scenario.file.name;
setMissionStart(scenario.file.startTime);

/** The browser's storage, or null where it is refused, as in some private windows. */
function saveStore(): SaveStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const store = saveStore();

/**
 * A battle left unfinished comes back when the page is reloaded or the menu's Resume is used.
 * A plain link with a seed starts that battle fresh, as it always has.
 */
function resumed(): GameSession | null {
  const save = store === null ? null : readSave(store);
  if (save === null) return null;
  const reloaded = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  const asked = search.get('resume') === '1';
  const sameSeed = search.get('seed') === null || parseSeed(search.get('seed'), () => NaN) === save.seed;
  if (!(asked || reloaded) || !sameSeed) return null;
  return resumeGame(scenario, save);
}

const restored = resumed();
const seed = restored?.commandLog().seed ?? parseSeed(search.get('seed'), () => Math.floor(Math.random() * 1_000_000));
const session = restored ?? new GameSession(scenario, seed);

// The address always names the battle being played, so it can be bookmarked, shared or reloaded.
search.set('scenario', scenario.file.id);
search.set('seed', String(seed));
search.delete('resume');
history.replaceState(null, '', `?${search.toString()}`);

// A resumed battle waits for the controller to look around first.
let paused = restored !== null;
let speed: number = parseSpeed(search.get('speed'));
let accumulator = 0;
let lastFrame = performance.now();

function exportLog(): void {
  const log = { ...session.commandLog(), stateHash: session.stateHash() };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }));
  link.download = `airops-log-${scenario.file.id}-${seed}.json`;
  link.click();
}

const friendlies = scenario.file.units.filter((unit) => unit.side === 'friendly');
const linkedToAirOps = scenario.file.links.flatMap(([a, b]) => (a === AIR_OPS ? [b] : b === AIR_OPS ? [a] : []));

const app = new App({
  terrain: scenario.terrain,
  // Friendly names only: the UI must not learn enemy identities from configuration.
  names: Object.fromEntries(friendlies.map((unit) => [unit.id, unit.name])),
  recipients: [...new Set(linkedToAirOps)].sort(),
  objective: mission.briefing,
  ackDistanceMeters: scenario.file.air.supportAckDistanceMeters,
  sensorRadius: (aircraft) =>
    Object.values(scenario.file.air.models).find((model) => model.displayName === aircraft.model)?.sensorRadiusMeters ?? 0,
  threatRadius: (weapons, altitudeMeters) =>
    Math.max(
      0,
      ...weapons
        .filter(isAntiAir)
        .map((weapon) =>
          threatRadiusMeters(
            scenario.file.combat.weapons[weapon],
            altitudeMeters,
            scenario.file.display.threatRiskPerMinute,
          ),
        ),
    ),
  weaponCeiling: (weapon) => scenario.file.combat.weapons[weapon].maxAltitudeMeters,
  maxAltitudeMeters: Math.max(...Object.values(scenario.file.air.models).map((type) => type.maxAltitudeMeters)),
  defaultAltitudeMeters: scenario.file.air.operatingAltitudeMeters,
  durationSeconds: scenario.file.durationSeconds,
  forecastError: {
    windMps: scenario.file.weather.forecastWindErrorMps,
    positionMeters: scenario.file.weather.forecastPositionErrorMeters,
  },
  // The player's own order of battle and the HQ estimate: nothing here reveals enemy truth.
  triage: scenario.file.display,
  fireFreshSeconds: scenario.file.display.fireLineFreshSeconds,
  mapContext: {
    objective: mission.area.center,
    friendlyStrength: Object.fromEntries(friendlies.map((unit) => [unit.id, unit.personnel])),
  },
  speeds: SPEEDS,
  onAction: (action) => session.issue(action),
  transmitSeconds: scenario.file.radio.transmitSeconds,
  onSpeed: (value) => {
    speed = value;
  },
  onTogglePause: () => {
    paused = !paused;
  },
  onExportLog: exportLog,
  truthHistory: () => session.truthHistory(),
  survivorId: mission.kind === 'Rescue' ? mission.survivorId : null,
  onWaitForLight: () => waitForLight(),
  onScenarios: () => {
    save();
    location.href = location.pathname;
  },
  onRunUntilNeeded: () => runUntilNeeded(),
  onRestart: () => {
    if (store !== null) clearSave(store);
    saving = false;
    location.href = `?${new URLSearchParams({ scenario: scenario.file.id, seed: String(seed) }).toString()}`;
  },
  seed,
});
if (restored !== null) {
  app.restore(restored.commandLog().commands.flatMap((command) => (command.said === undefined ? [] : [{ tick: command.tick, text: command.said }])));
}

/** Autosave: often enough that little is lost, and at once when a command has been given. */
const SAVE_INTERVAL_TICKS = 30;
let saving = true;
let savedAtTick = session.tick;
let savedCommands = session.commandCount;

function save(): void {
  if (store === null || !saving) return;
  if (session.outcome !== 'running') {
    // A finished battle has nothing left to resume.
    clearSave(store);
    saving = false;
    return;
  }
  if (session.tick === 0) return;
  saveGame(store, session, scenario);
  savedAtTick = session.tick;
  savedCommands = session.commandCount;
}

function saveIfDue(): void {
  if (session.outcome !== 'running' || session.tick - savedAtTick >= SAVE_INTERVAL_TICKS || session.commandCount !== savedCommands) save();
}
window.addEventListener('pagehide', save);

// A hook for end-to-end tests. It exposes what the player already has, never truth.
Object.assign(window, {
  airops: {
    app,
    session: { commandLog: () => session.commandLog(), stateHash: () => session.stateHash() },
    view: () => session.view(),
    setSpeed: (value: number) => {
      speed = value;
    },
  },
});

/** A fast run: to first light, or to the end, stopping when something needs the controller. */
let skipUntil: number | null = null;
/** Whether the run pauses when it stops, or carries on at normal speed. */
let pauseAfterSkip = false;
let attention: ReadonlySet<string> = new Set();
const SKIP_CHUNK_TICKS = 30;
const SKIP_TICKS_PER_FRAME = 900;

function waitForLight(): void {
  const view = session.view();
  const sky = view.forecast?.sky;
  if (sky === undefined || session.outcome !== 'running') return;
  skipUntil = nextFirstLight(sky, view.tick);
  pauseAfterSkip = false;
  paused = false;
}

/** Runs on until something needs the controller, then pauses so that it can be dealt with. */
function runUntilNeeded(): void {
  if (session.outcome !== 'running') return;
  skipUntil = scenario.file.durationSeconds;
  pauseAfterSkip = true;
  attention = attentionKeys(session.view());
  paused = false;
}

function skip(): void {
  if (skipUntil === null) return;
  for (let done = 0; done < SKIP_TICKS_PER_FRAME; done += SKIP_CHUNK_TICKS) {
    const before = session.view().log.length;
    for (let i = 0; i < SKIP_CHUNK_TICKS; i += 1) session.advance();
    const view = session.view();
    // Waiting for first light stops as it always has: for the radio, or a helicopter on the ground.
    // Running on stops for more, since there the controller asked to be told of anything new.
    const needed = pauseAfterSkip ? needsAttention(attention, before, view) : view.aircraft.some((aircraft) => aircraft.landed) || radioNeedsAttention(before, view);
    if (session.outcome !== 'running' || session.tick >= skipUntil || needed) {
      skipUntil = null;
      speed = 1;
      paused = pauseAfterSkip && session.outcome === 'running';
      return;
    }
    // Something that has passed, such as an aircraft leaving its station, can stop the run again later.
    attention = attentionKeys(view);
  }
}

/**
 * While paused nothing moves by itself, so the interface is drawn only after the controller does
 * something, and a few times a second besides in case something changed without an event.
 */
const IDLE_DRAW_EVERY_FRAMES = 10;
let drawFrames = 2;
let idleFrames = 0;
for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'keydown', 'keyup', 'input', 'change', 'wheel', 'contextmenu']) {
  document.addEventListener(type, () => { drawFrames = 2; }, { capture: true, passive: true });
}
window.addEventListener('resize', () => { drawFrames = 2; });

function frame(now: number): void {
  const elapsedSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  const wasPaused = paused;
  const tickBefore = session.tick;
  if (paused) skipUntil = null;
  if (skipUntil !== null) skip();
  else if (!paused) {
    accumulator += elapsedSeconds * speed;
    let ticks = 0;
    while (accumulator >= 1 && ticks < MAX_TICKS_PER_FRAME) {
      session.advance();
      accumulator -= 1;
      ticks += 1;
    }
    if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;
  }
  if (session.tick !== tickBefore) saveIfDue();
  idleFrames = (idleFrames + 1) % IDLE_DRAW_EVERY_FRAMES;
  const idle = paused && wasPaused && session.tick === tickBefore && drawFrames === 0 && idleFrames !== 0;
  if (drawFrames > 0) drawFrames -= 1;
  if (!idle) {
    const result = session.outcome === 'running' ? null : mission.results[session.outcome];
    app.update(session.view(), { paused, speed, result, debrief: session.debrief() });
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
