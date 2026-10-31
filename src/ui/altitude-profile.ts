import type { AircraftId, AircraftTelemetryEntry } from '../domain/public/air';
import type { WeaponType } from '../domain/public/equipment';
import type { Vec2 } from '../domain/public/geometry';
import type { PlayerView } from '../knowledge/player-view';
import { aircraftSummary, altitudeFraction, ceilingLabel, shortAircraftName, snappedAltitude } from './format';

export const PROFILE_GUTTER_PIXELS = 44;
const TOP_PIXELS = 8;
const BOTTOM_PIXELS = 18;
const DRAG_PIXELS = 4;
const SCALE_TICKS = [100, 300, 500, 1000, 2000, 3000];

export type ProfileConfig = Readonly<{
  maxAltitudeMeters: number;
  weaponCeiling: (weapon: WeaponType) => number;
  groundAt: (point: Vec2) => number;
  onSelect: (id: AircraftId) => void;
  onSetAltitude: (id: AircraftId, meters: number) => void;
}>;

type Drag = { id: AircraftId; startY: number; meters: number | null };

/** All aircraft on one altitude scale. Click selects a column; dragging sets its target. */
export class AltitudeProfile {
  private readonly ctx: CanvasRenderingContext2D;
  private aircraft: readonly AircraftTelemetryEntry[] = [];
  private selectedId: string | null = null;
  private drag: Drag | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly config: ProfileConfig,
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D is unavailable');
    this.ctx = context;
    canvas.addEventListener('mousedown', (event) => this.startDrag(event));
    canvas.addEventListener('mousemove', (event) => {
      const entry = this.columnAt(event.offsetX);
      canvas.title = entry === null ? '' : aircraftSummary(entry);
    });
    window.addEventListener('mousemove', (event) => this.moveDrag(event));
    window.addEventListener('mouseup', () => this.endDrag());
  }

  private get usableHeight(): number {
    return this.canvas.height - TOP_PIXELS - BOTTOM_PIXELS;
  }

  private yFor(meters: number): number {
    const fraction = altitudeFraction(meters, this.config.maxAltitudeMeters);
    return this.canvas.height - BOTTOM_PIXELS - fraction * this.usableHeight;
  }

  /** Screen position of an aircraft's column, or null if it isn't shown. */
  columnPixel(id: string): number | null {
    const index = this.aircraft.findIndex((aircraft) => aircraft.aircraftId === id);
    return index < 0 ? null : this.columnX(index);
  }

  private columnX(index: number): number {
    const width = (this.canvas.width - PROFILE_GUTTER_PIXELS) / Math.max(1, this.aircraft.length);
    return PROFILE_GUTTER_PIXELS + width * (index + 0.5);
  }

  private columnAt(x: number): AircraftTelemetryEntry | null {
    const width = (this.canvas.width - PROFILE_GUTTER_PIXELS) / Math.max(1, this.aircraft.length);
    return this.aircraft[Math.floor((x - PROFILE_GUTTER_PIXELS) / width)] ?? null;
  }

  private metersAt(clientY: number): number {
    const y = clientY - this.canvas.getBoundingClientRect().top;
    const fraction = (this.canvas.height - BOTTOM_PIXELS - y) / this.usableHeight;
    return snappedAltitude(fraction, this.config.maxAltitudeMeters);
  }

  private startDrag(event: MouseEvent): void {
    const entry = this.columnAt(event.offsetX);
    if (entry !== null) this.drag = { id: entry.aircraftId, startY: event.clientY, meters: null };
  }

  private moveDrag(event: MouseEvent): void {
    if (this.drag === null) return;
    if (this.drag.meters === null && Math.abs(event.clientY - this.drag.startY) < DRAG_PIXELS) return;
    this.drag.meters = this.metersAt(event.clientY);
  }

  private endDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag === null) return;
    if (drag.meters === null) this.config.onSelect(drag.id);
    else this.config.onSetAltitude(drag.id, drag.meters);
  }

  render(view: PlayerView, selectedId: string | null): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    if (canvas.width !== width) canvas.width = width;
    // Parked aircraft have no altitude worth showing, unless the player is setting one up.
    this.aircraft = view.aircraft.filter((a) => a.altitudeMeters > 0 || a.aircraftId === selectedId);
    this.selectedId = selectedId;
    ctx.fillStyle = '#10140f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawScale();
    this.drawCeilings(view);
    this.aircraft.forEach((aircraft, index) => {
      this.drawColumn(aircraft, this.columnX(index), aircraft.aircraftId === this.selectedId);
    });
    if (this.aircraft.length === 0) {
      ctx.fillStyle = '#9fb0a8';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No aircraft airborne', (canvas.width + PROFILE_GUTTER_PIXELS) / 2, canvas.height / 2);
      ctx.textAlign = 'left';
    }
  }

  private drawScale(): void {
    const { ctx, canvas } = this;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    const ground = this.yFor(0);
    for (const meters of [0, ...SCALE_TICKS]) {
      const y = this.yFor(meters);
      ctx.strokeStyle = meters === 0 ? '#7d8a60' : 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(PROFILE_GUTTER_PIXELS, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
      ctx.fillStyle = '#9fb0a8';
      ctx.fillText(String(meters), PROFILE_GUTTER_PIXELS - 5, Math.min(ground + 3, y + 3));
    }
    ctx.textAlign = 'left';
  }

  /** Only weapons the player has seen: this panel must not reveal a hidden one. */
  private drawCeilings(view: PlayerView): void {
    const { ctx, canvas } = this;
    // A weapon reaches higher from a hill, so each line uses the highest place it was seen.
    const seen = new Map<WeaponType, number>();
    const note = (weapon: WeaponType, point: Vec2): void => {
      seen.set(weapon, Math.max(seen.get(weapon) ?? 0, this.config.groundAt(point)));
    };
    for (const marker of view.contacts) {
      for (const weapon of marker.contact.observedWeapons) note(weapon, marker.contact.position.center);
    }
    for (const message of view.log) {
      if (message.kind === 'GROUND_FIRE' && message.weapon !== null) note(message.weapon, message.source.center);
    }
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    for (const weapon of [...seen.keys()].sort()) {
      const y = this.yFor(this.config.weaponCeiling(weapon) + (seen.get(weapon) ?? 0));
      ctx.strokeStyle = '#ff3df0';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(PROFILE_GUTTER_PIXELS, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff3df0';
      ctx.fillText(ceilingLabel(weapon), canvas.width - 3, y - 2);
    }
    ctx.textAlign = 'left';
  }

  private drawColumn(aircraft: AircraftTelemetryEntry, x: number, selected: boolean): void {
    const { ctx } = this;
    const color = aircraft.aircraftType === 'cas' ? '#ffe066' : '#66e0ff';
    const dragged = this.drag?.id === aircraft.aircraftId ? this.drag.meters : null;
    const target = this.yFor(dragged ?? aircraft.targetAltitudeMeters);
    const at = this.yFor(aircraft.altitudeMeters);
    const ground = this.yFor(this.config.groundAt(aircraft.position));
    ctx.fillStyle = '#6d7f55';
    ctx.fillRect(x - 14, ground, 28, this.yFor(0) - ground);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 12, target);
    ctx.lineTo(x + 12, target);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, at);
    ctx.lineTo(x, target);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? '#ffffff' : '#000000';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, at - 7);
    ctx.lineTo(x + 7, at + 5);
    ctx.lineTo(x - 7, at + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = selected ? '#ffffff' : '#9fb0a8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(shortAircraftName(aircraft.aircraftId), x, this.canvas.height - 4);
    ctx.textAlign = 'left';
  }
}
