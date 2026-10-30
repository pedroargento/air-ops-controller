// Omniscient debug view. Reads hidden truth by design; never linked from the game page.
import scenarioJson from '../../scenarios/outpost-under-pressure.json';
import classLayer from '../../scenarios/outpost-under-pressure/terrain.txt?raw';
import elevationLayer from '../../scenarios/outpost-under-pressure/elevation.txt?raw';
import { runBattle } from '../cli/battle';
import { policies } from '../cli/policy-registry';
import type { AircraftType } from '../domain/public/air';
import type { Vec2 } from '../domain/public/geometry';
import { cellAtIndex } from '../domain/public/terrain';
import type { GroundUnit } from '../domain/truth/world';
import { loadScenario } from '../scenario/load';
import { aircraftTelemetry } from '../sim/air';
import { advancePlayhead } from './playback';

type UnitFrame = Pick<
  GroundUnit,
  'id' | 'side' | 'position' | 'personnel' | 'ammunition' | 'morale' | 'suppression' | 'mode' | 'posture'
> & { target: Vec2 | null };

type AircraftFrame = Readonly<{
  id: string;
  aircraftType: AircraftType;
  position: Vec2;
  status: string;
  fuelFraction: number;
  ammunition: number;
}>;

type Frame = Readonly<{
  tick: number;
  units: readonly UnitFrame[];
  aircraft: readonly AircraftFrame[];
}>;

const AIRCRAFT_SIZE = 11;

const TERRAIN_COLORS: Record<string, string> = {
  open: '#6b7a4f',
  forest: '#3f5f38',
  jungle: '#264a2a',
  outpost: '#8a7a5c',
  road: '#a08f6a',
  stream: '#3f6f8f',
};
const MODE_COLORS: Record<GroundUnit['mode'], string> = {
  steady: '#ffffff',
  withdrawing: '#ffd166',
  recovering: '#a0a0ff',
  broken: '#777777',
};

const scenario = loadScenario(scenarioJson, classLayer, elevationLayer);
const { terrain } = scenario;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element ${id}`);
  return element as T;
}

const canvas = byId<HTMLCanvasElement>('map');
const context = canvas.getContext('2d');
if (context === null) throw new Error('Canvas 2D is unavailable');
const ctx = context;
const scrub = byId<HTMLInputElement>('scrub');
const metersToPixels = canvas.width / (terrain.width * terrain.cellSize);
const toScreen = (p: Vec2): Vec2 => ({ x: p.x * metersToPixels, y: p.y * metersToPixels });

const terrainImage = document.createElement('canvas');
terrainImage.width = canvas.width;
terrainImage.height = canvas.height;
const terrainContext = terrainImage.getContext('2d');
if (terrainContext !== null) {
  const size = terrain.cellSize * metersToPixels;
  for (let index = 0; index < terrain.classIndex.length; index += 1) {
    const cell = cellAtIndex(terrain, index);
    terrainContext.fillStyle = TERRAIN_COLORS[cell.terrainClass] ?? '#000';
    terrainContext.globalAlpha = 0.65 + (terrain.elevation[index] ?? 0) / 250;
    terrainContext.fillRect(
      (index % terrain.width) * size,
      Math.floor(index / terrain.width) * size,
      size + 0.5,
      size + 0.5,
    );
  }
}

let frames: readonly Frame[] = [];
let playing = false;
let playhead = 0;
let lastDrawAt = 0;

function targetOf(unit: GroundUnit): Vec2 | null {
  if (unit.intent.kind === 'move') return unit.intent.destination;
  return unit.intent.kind === 'engage' ? unit.intent.closeTo : null;
}

function recordBattle(seed: number, policyName: string): void {
  const recorded: Frame[] = [];
  const make = policies(scenario)[policyName];
  if (make === undefined) throw new Error(`Unknown policy ${policyName}`);
  const result = runBattle(scenario, seed, make(), (state) => {
    recorded.push({
      tick: state.tick,
      aircraft: aircraftTelemetry(state.truth, scenario.file.air).map((a) => ({
        id: a.aircraftId,
        aircraftType: a.aircraftType,
        position: a.position,
        status: a.status,
        fuelFraction: a.fuelFraction,
        ammunition: a.ammunition,
      })),
      units: state.truth.units.map((u) => ({
        id: u.id,
        side: u.side,
        position: u.position,
        personnel: u.personnel,
        ammunition: u.ammunition,
        morale: u.morale,
        suppression: u.suppression,
        mode: u.mode,
        posture: u.posture,
        target: targetOf(u),
      })),
    });
  });
  frames = recorded;
  scrub.max = String(recorded.length - 1);
  scrub.value = '0';
  byId('result').textContent = JSON.stringify(result, null, 1);
}

// Points along the direction of travel since the previous frame.
function headingOf(aircraft: AircraftFrame, previous: Frame | undefined): number {
  const before = previous?.aircraft.find((a) => a.id === aircraft.id)?.position;
  if (before === undefined) return Math.PI / 2;
  const dx = aircraft.position.x - before.x;
  const dy = aircraft.position.y - before.y;
  return dx === 0 && dy === 0 ? Math.PI / 2 : Math.atan2(dy, dx);
}

/** Swept-wing outline, nose along +x. CAS is wide and yellow, recon narrow and cyan. */
function drawAircraft(aircraft: AircraftFrame, previous: Frame | undefined): void {
  const at = toScreen(aircraft.position);
  const span = aircraft.aircraftType === 'cas' ? AIRCRAFT_SIZE : AIRCRAFT_SIZE * 0.65;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(headingOf(aircraft, previous));
  ctx.beginPath();
  ctx.moveTo(AIRCRAFT_SIZE, 0);
  ctx.lineTo(-AIRCRAFT_SIZE * 0.7, span);
  ctx.lineTo(-AIRCRAFT_SIZE * 0.25, 0);
  ctx.lineTo(-AIRCRAFT_SIZE * 0.7, -span);
  ctx.closePath();
  ctx.fillStyle = aircraft.aircraftType === 'cas' ? '#ffe066' : '#66e0ff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(aircraft.id, at.x + AIRCRAFT_SIZE + 3, at.y + 4);
}

function draw(index: number): void {
  const frame = frames[index];
  if (frame === undefined) return;
  // The terrain image is partly transparent, so clear first or old frames show through.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(terrainImage, 0, 0);

  const area = scenario.file.capture.area;
  const center = toScreen(area.center);
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(center.x, center.y, area.radius * metersToPixels, 0, Math.PI * 2);
  ctx.stroke();

  for (const unit of frame.units) {
    if (unit.personnel <= 0) continue;
    const at = toScreen(unit.position);
    if (unit.target !== null) {
      const target = toScreen(unit.target);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    ctx.fillStyle = unit.side === 'friendly' ? '#4da3ff' : '#ff5a5a';
    ctx.strokeStyle = MODE_COLORS[unit.mode];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5 + Math.sqrt(unit.personnel), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${unit.id} ${unit.personnel}`, at.x + 12, at.y - 8);
  }

  for (const aircraft of frame.aircraft) drawAircraft(aircraft, frames[index - 1]);

  byId('time').textContent = `${Math.floor(frame.tick / 60)}m ${frame.tick % 60}s`;
  byId('units').textContent = frame.units
    .map(
      (u) =>
        `${u.id.padEnd(5)} ${String(u.personnel).padStart(3)} ` +
        `amm ${String(Math.round(u.ammunition)).padStart(5)} ` +
        `mor ${u.morale.toFixed(2)} sup ${u.suppression.toFixed(2)} ${u.mode}`,
    )
    .concat(
      frame.aircraft.map(
        (a) =>
          `${a.id.padEnd(8)} ${a.status.padEnd(10)} ` +
          `fuel ${Math.round(a.fuelFraction * 100)}% amm ${a.ammunition}`,
      ),
    )
    .join('\n');
}

function animate(now: number): void {
  if (playing) {
    const speed = Number(byId<HTMLSelectElement>('speed').value);
    playhead = advancePlayhead(playhead, now - lastDrawAt, speed, frames.length - 1);
    scrub.value = String(Math.floor(playhead));
    draw(Number(scrub.value));
    if (playhead >= frames.length - 1) playing = false;
  }
  lastDrawAt = now;
  requestAnimationFrame(animate);
}

function runSelected(): void {
  recordBattle(Number(byId<HTMLInputElement>('seed').value), byId<HTMLSelectElement>('policy').value);
  playhead = 0;
  draw(0);
}

byId('run').addEventListener('click', runSelected);
byId('play').addEventListener('click', () => {
  if (playhead >= frames.length - 1) playhead = 0;
  playing = !playing;
});
scrub.addEventListener('input', () => {
  playhead = Number(scrub.value);
  draw(playhead);
});

// Opens a specific moment, e.g. /debug.html?policy=informed&seed=3&minute=30
const startAt = new URLSearchParams(location.search);
byId<HTMLInputElement>('seed').value = startAt.get('seed') ?? '1';
byId<HTMLSelectElement>('policy').value = startAt.get('policy') ?? 'none';
runSelected();
playhead = Math.round(Number(startAt.get('minute') ?? 0) * 60);
scrub.value = String(playhead);
draw(Number(scrub.value));
requestAnimationFrame(animate);
