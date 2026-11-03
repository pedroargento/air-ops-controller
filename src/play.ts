import { isAntiAir, threatRadiusMeters } from './domain/public/equipment';
import { AIR_OPS, CECON, reportLevel } from './domain/public/radio';
import { nextFirstLight } from './domain/public/light';
import { GameSession } from './game/session';
import { DEFAULT_SCENARIO_NAME, loadBundledScenario } from './scenario/catalog';
import { App } from './ui/app';
import { setMissionStart } from './ui/format';

const SPEEDS = [1, 2, 4, 8] as const;
const MAX_TICKS_PER_FRAME = 20;

const search = new URLSearchParams(location.search);
const scenario = loadBundledScenario(search.get('scenario') ?? DEFAULT_SCENARIO_NAME);
document.body.classList.add('playing');
const { mission } = scenario.file;
document.title = scenario.file.name;
setMissionStart(scenario.file.startTime);
const seed = Number(search.get('seed') ?? Math.floor(Math.random() * 1_000_000));
const session = new GameSession(scenario, seed);

let paused = false;
let speed: number = Number(search.get('speed') ?? 1);
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
  summary: {
    objective: mission.area.center,
    objectiveRadiusMeters: mission.area.radius,
    areaLabel: mission.areaLabel,
    hqEnemyEstimate: scenario.file.display.hqEnemyEstimate,
    ratioRadiusMeters: scenario.file.display.summaryRatioRadiusMeters,
    staleSeconds: scenario.file.display.summaryStaleSeconds,
    friendlyStrength: Object.fromEntries(friendlies.map((unit) => [unit.id, unit.personnel])),
    plausibleSpeedMps: scenario.file.display.plausibleSpeedMps,
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
    location.href = location.pathname;
  },
});

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

/** Waiting for first light: the battle runs fast until dawn, or until something needs the controller. */
let skipUntil: number | null = null;
const SKIP_CHUNK_TICKS = 30;
const SKIP_TICKS_PER_FRAME = 900;

function waitForLight(): void {
  const view = session.view();
  const sky = view.forecast?.sky;
  if (sky === undefined || session.outcome !== 'running') return;
  skipUntil = nextFirstLight(sky, view.tick);
  paused = false;
}

/** A message that should stop the wait: anything urgent or main from a unit or an aircraft. */
function interrupts(from: number): boolean {
  const view = session.view();
  if (view.aircraft.some((aircraft) => aircraft.landed)) return true;
  return view.log.slice(from).some((message) => message.senderId !== CECON && message.senderId !== AIR_OPS && reportLevel(message) !== 'routine');
}

function skip(): void {
  if (skipUntil === null) return;
  for (let done = 0; done < SKIP_TICKS_PER_FRAME; done += SKIP_CHUNK_TICKS) {
    const before = session.view().log.length;
    for (let i = 0; i < SKIP_CHUNK_TICKS; i += 1) session.advance();
    if (session.outcome !== 'running' || session.tick >= skipUntil || interrupts(before)) {
      skipUntil = null;
      speed = 1;
      return;
    }
  }
}

function frame(now: number): void {
  const elapsedSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
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
  const result = session.outcome === 'running' ? null : mission.results[session.outcome];
  app.update(session.view(), { paused, speed, result, debrief: session.debrief() });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
