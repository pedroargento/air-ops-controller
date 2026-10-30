import type { AircraftTelemetry, AircraftTelemetryEntry } from '../domain/public/air';
import type { Vec2 } from '../domain/public/geometry';
import { cellAtIndex, type TerrainGrid } from '../domain/public/terrain';
import type {
  ContactMarker,
  FriendlyMarkerView,
  PlayerView,
  ReachableRegion,
  StrikeEffect,
} from '../knowledge/player-view';

export type Selection =
  | Readonly<{ kind: 'aircraft'; id: string }>
  | Readonly<{ kind: 'friendly'; id: string }>
  | Readonly<{ kind: 'contact'; key: string }>
  | null;

export type MapHit = Exclude<Selection, null>;

const TERRAIN_COLORS: Readonly<Record<string, string>> = {
  open: '#7d8a60',
  forest: '#4d6b45',
  jungle: '#33553a',
  outpost: '#9b8a68',
  road: '#b3a27c',
  stream: '#4a7a9a',
};

const HIT_RADIUS_PIXELS = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const EDGE_MARGIN = 18;
const STRIKE_LINE_SECONDS = 4;
const STRIKE_FADE_SECONDS = 20;

export class MapView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrainImage: HTMLCanvasElement;
  private readonly worldSize: number;
  private center: Vec2;
  private zoom = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly terrain: TerrainGrid,
    private readonly sensorRadius: (aircraft: AircraftTelemetryEntry) => number,
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D is unavailable');
    this.ctx = context;
    this.worldSize = terrain.width * terrain.cellSize;
    this.center = { x: this.worldSize / 2, y: this.worldSize / 2 };
    this.terrainImage = this.paintTerrain();
  }

  private paintTerrain(): HTMLCanvasElement {
    const { terrain } = this;
    const image = document.createElement('canvas');
    image.width = terrain.width;
    image.height = terrain.height;
    const context = image.getContext('2d');
    if (context === null) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, image.width, image.height);
    for (let index = 0; index < terrain.classIndex.length; index += 1) {
      context.globalAlpha = 0.65 + (terrain.elevation[index] ?? 0) / 250;
      context.fillStyle = TERRAIN_COLORS[cellAtIndex(terrain, index).terrainClass] ?? '#000000';
      context.fillRect(index % terrain.width, Math.floor(index / terrain.width), 1, 1);
    }
    return image;
  }

  private get pixelsPerMeter(): number {
    return (Math.min(this.canvas.width, this.canvas.height) / this.worldSize) * this.zoom;
  }

  toScreen(point: Vec2): Vec2 {
    const scale = this.pixelsPerMeter;
    return {
      x: this.canvas.width / 2 + (point.x - this.center.x) * scale,
      y: this.canvas.height / 2 + (point.y - this.center.y) * scale,
    };
  }

  toWorld(pixel: Vec2): Vec2 {
    const scale = this.pixelsPerMeter;
    return {
      x: this.center.x + (pixel.x - this.canvas.width / 2) / scale,
      y: this.center.y + (pixel.y - this.canvas.height / 2) / scale,
    };
  }

  centerOn(point: Vec2): void {
    this.center = point;
  }

  get viewCenter(): Vec2 {
    return this.center;
  }

  panBy(dx: number, dy: number): void {
    const scale = this.pixelsPerMeter;
    this.center = { x: this.center.x - dx / scale, y: this.center.y - dy / scale };
  }

  zoomBy(factor: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Aircraft can be off-map during transit, so they are pinned to the map edge. */
  private aircraftPixel(aircraft: AircraftTelemetryEntry): Vec2 {
    const at = this.toScreen(aircraft.position);
    return {
      x: Math.max(EDGE_MARGIN, Math.min(this.canvas.width - EDGE_MARGIN, at.x)),
      y: Math.max(EDGE_MARGIN, Math.min(this.canvas.height - EDGE_MARGIN, at.y)),
    };
  }

  /** Everything under the cursor, nearest first, so overlapping markers can all be reached. */
  hitsAt(pixel: Vec2, view: PlayerView): readonly MapHit[] {
    const hits: { hit: MapHit; gap: number }[] = [];
    const consider = (point: Vec2, hit: MapHit): void => {
      const gap = Math.hypot(point.x - pixel.x, point.y - pixel.y);
      if (gap <= HIT_RADIUS_PIXELS) hits.push({ hit, gap });
    };
    for (const aircraft of view.aircraft) {
      if (aircraft.status === 'ready' || aircraft.status === 'turnaround') continue;
      consider(this.aircraftPixel(aircraft), { kind: 'aircraft', id: aircraft.aircraftId });
    }
    for (const friendly of view.friendlies) {
      consider(this.toScreen(friendly.position.center), { kind: 'friendly', id: friendly.unitId });
    }
    for (const marker of view.contacts) {
      consider(this.toScreen(marker.contact.position.center), { kind: 'contact', key: marker.key });
    }
    return hits.sort((a, b) => a.gap - b.gap).map(({ hit }) => hit);
  }

  render(view: PlayerView, selection: Selection): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#10140f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const origin = this.toScreen({ x: 0, y: 0 });
    const size = this.worldSize * this.pixelsPerMeter;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainImage, origin.x, origin.y, size, size);
    this.drawGrid(origin, size);

    const shown = (fade: number, selected: boolean): number => (selected ? Math.max(fade, 0.6) : fade);
    for (const marker of view.contacts) {
      const selected = selection?.kind === 'contact' && selection.key === marker.key;
      this.drawRegion(marker.region, shown(marker.regionOpacity, selected), '#ff6b5a');
    }
    for (const friendly of view.friendlies) {
      const selected = selection?.kind === 'friendly' && selection.id === friendly.unitId;
      this.drawRegion(friendly.region, shown(friendly.regionOpacity, selected), '#59a8ff');
    }
    for (const marker of view.contacts) {
      this.drawContact(marker, selection?.kind === 'contact' && selection.key === marker.key);
    }
    for (const friendly of view.friendlies) {
      this.drawFriendly(friendly, selection?.kind === 'friendly' && selection.id === friendly.unitId);
    }
    for (const marker of view.contacts) {
      if (marker.engaging) this.drawFireRing(marker.contact.position.center, view.tick);
    }
    for (const friendly of view.friendlies) {
      if (friendly.engaging) this.drawFireRing(friendly.position.center, view.tick);
    }
    for (const flag of view.ticFlags) {
      if (flag.ageSeconds <= 300) this.drawTic(flag.position.center);
    }
    for (const aircraft of view.aircraft) {
      if (aircraft.status === 'ready' || aircraft.status === 'turnaround') continue;
      this.drawAircraft(aircraft, selection?.kind === 'aircraft' && selection.id === aircraft.aircraftId);
    }
    for (const strike of view.strikes) this.drawStrike(strike, view.aircraft);
  }

  /** Pulsing ring on anything reported or seen fighting. */
  private drawFireRing(point: Vec2, tick: number): void {
    const { ctx } = this;
    const at = this.toScreen(point);
    const pulse = (tick % 3) / 3;
    ctx.strokeStyle = '#ffae3d';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9 - pulse * 0.6;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 13 + pulse * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Attack line for the first seconds of a pass, then a burst that spreads and fades. */
  private drawStrike(strike: StrikeEffect, aircraft: AircraftTelemetry): void {
    const { ctx } = this;
    const at = this.toScreen(strike.position);
    const shooter = aircraft.find((a) => a.aircraftId === strike.aircraftId);
    if (shooter !== undefined && strike.ageSeconds <= STRIKE_LINE_SECONDS) {
      const from = this.toScreen(shooter.position);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(at.x, at.y);
      ctx.stroke();
    }
    const progress = Math.min(1, strike.ageSeconds / STRIKE_FADE_SECONDS);
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = strike.effectObserved ? '#ff7a1a' : '#b0b0b0';
    ctx.beginPath();
    ctx.arc(at.x, at.y, 8 + progress * 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawGrid(origin: Vec2, size: number): void {
    const { ctx } = this;
    const lines = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= lines; i += 1) {
      const offset = (size * i) / lines;
      ctx.moveTo(origin.x + offset, origin.y);
      ctx.lineTo(origin.x + offset, origin.y + size);
      ctx.moveTo(origin.x, origin.y + offset);
      ctx.lineTo(origin.x + size, origin.y + offset);
    }
    ctx.stroke();
  }

  private drawRegion(region: ReachableRegion, opacity: number, color: string): void {
    const { ctx } = this;
    const radius = region.radiusMeters * this.pixelsPerMeter;
    if (opacity <= 0) return;
    ctx.globalAlpha = 0.14 * opacity;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (region.kind === 'circle') {
      const at = this.toScreen(region.center);
      ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    } else {
      const at = this.toScreen(region.origin);
      ctx.moveTo(at.x, at.y);
      ctx.arc(at.x, at.y, radius, region.headingRad - region.halfAngleRad, region.headingRad + region.halfAngleRad);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 0.35 * opacity;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawContact(marker: ContactMarker, selected: boolean): void {
    const { ctx } = this;
    const at = this.toScreen(marker.contact.position.center);
    const size = 8;
    ctx.globalAlpha = marker.opacity;
    ctx.fillStyle = marker.contact.identification === 'hostile' ? '#e8483a' : '#e0b040';
    ctx.strokeStyle = selected ? '#ffffff' : '#000000';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - size);
    ctx.lineTo(at.x + size, at.y);
    ctx.lineTo(at.x, at.y + size);
    ctx.lineTo(at.x - size, at.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawFriendly(friendly: FriendlyMarkerView, selected: boolean): void {
    const { ctx } = this;
    const at = this.toScreen(friendly.position.center);
    ctx.globalAlpha = friendly.opacity;
    ctx.fillStyle = '#3f8fe8';
    ctx.strokeStyle = selected ? '#ffffff' : '#000000';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.fillRect(at.x - 9, at.y - 6, 18, 12);
    ctx.strokeRect(at.x - 9, at.y - 6, 18, 12);
    ctx.globalAlpha = 1;
  }

  private drawTic(point: Vec2): void {
    const { ctx } = this;
    const at = this.toScreen(point);
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - 10);
    ctx.lineTo(at.x, at.y - 26);
    ctx.lineTo(at.x + 12, at.y - 21);
    ctx.lineTo(at.x, at.y - 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private destinationOf(aircraft: AircraftTelemetryEntry): Vec2 | null {
    const { order } = aircraft;
    if (order === null || order.kind === 'ReturnToBase') return null;
    return order.kind === 'MoveTo' || order.kind === 'Orbit' ? order.point : order.center;
  }

  private drawAircraft(aircraft: AircraftTelemetryEntry, selected: boolean): void {
    const { ctx } = this;
    const at = this.aircraftPixel(aircraft);
    const destination = this.destinationOf(aircraft);
    const color = aircraft.aircraftType === 'cas' ? '#ffe066' : '#66e0ff';

    if (selected) {
      const position = this.toScreen(aircraft.position);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(position.x, position.y, this.sensorRadius(aircraft) * this.pixelsPerMeter, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (destination !== null && aircraft.status !== 'onStation') {
      const target = this.toScreen(destination);
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const size = 11;
    const span = aircraft.aircraftType === 'cas' ? size : size * 0.65;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(aircraft.headingRad);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, span);
    ctx.lineTo(-size * 0.25, 0);
    ctx.lineTo(-size * 0.7, -span);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? '#ffffff' : '#000000';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(aircraft.aircraftId, at.x + 14, at.y + 4);
  }
}
