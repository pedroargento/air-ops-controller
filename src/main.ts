import { isAntiAir, threatRadiusMeters } from './domain/public/equipment';
import scenarioJson from '../scenarios/outpost-under-pressure.json';
import classLayer from '../scenarios/outpost-under-pressure/terrain.txt?raw';
import elevationLayer from '../scenarios/outpost-under-pressure/elevation.txt?raw';
import { AIR_OPS } from './domain/public/radio';
import { GameSession } from './game/session';
import { loadScenario } from './scenario/load';
import { App } from './ui/app';

const SPEEDS = [1, 2, 4, 8] as const;
const MAX_TICKS_PER_FRAME = 20;
const RESULT_TEXT: Readonly<Record<string, string>> = {
  held: 'OUTPOST HELD: mission success',
  heldBelowStrength: 'OUTPOST HELD, too few defenders: mission failed',
  captured: 'OUTPOST LOST: mission failed',
};

const scenario = loadScenario(scenarioJson, classLayer, elevationLayer);
const search = new URLSearchParams(location.search);
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
  link.download = `airops-log-${seed}.json`;
  link.click();
}

const friendlies = scenario.file.units.filter((unit) => unit.side === 'friendly');
const linkedToAirOps = scenario.file.links.flatMap(([a, b]) => (a === AIR_OPS ? [b] : b === AIR_OPS ? [a] : []));

const app = new App({
  terrain: scenario.terrain,
  // Friendly names only: the UI must not learn enemy identities from configuration.
  names: Object.fromEntries(friendlies.map((unit) => [unit.id, unit.name])),
  recipients: [...new Set(linkedToAirOps)].sort(),
  objective: `Hold the outpost for ${Math.round(scenario.file.durationSeconds / 60)} minutes`,
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
  // The player's own order of battle and the HQ estimate: nothing here reveals enemy truth.
  summary: {
    objective: scenario.file.capture.area.center,
    objectiveRadiusMeters: scenario.file.capture.area.radius,
    hqEnemyEstimate: scenario.file.display.hqEnemyEstimate,
    ratioRadiusMeters: scenario.file.display.summaryRatioRadiusMeters,
    staleSeconds: scenario.file.display.summaryStaleSeconds,
    friendlyStrength: Object.fromEntries(friendlies.map((unit) => [unit.id, unit.personnel])),
    plausibleSpeedMps: scenario.file.display.plausibleSpeedMps,
  },
  speeds: SPEEDS,
  onAction: (action) => session.issue(action),
  onSpeed: (value) => {
    speed = value;
  },
  onTogglePause: () => {
    paused = !paused;
  },
  onExportLog: exportLog,
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

function frame(now: number): void {
  const elapsedSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!paused) {
    accumulator += elapsedSeconds * speed;
    let ticks = 0;
    while (accumulator >= 1 && ticks < MAX_TICKS_PER_FRAME) {
      session.advance();
      accumulator -= 1;
      ticks += 1;
    }
    if (ticks === MAX_TICKS_PER_FRAME) accumulator = 0;
  }
  const result = session.outcome === 'running' ? null : (RESULT_TEXT[session.outcome] ?? session.outcome);
  app.update(session.view(), { paused, speed, result, debrief: session.debrief() });
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
