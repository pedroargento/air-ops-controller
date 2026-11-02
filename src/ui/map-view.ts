import type { AircraftTelemetry, AircraftTelemetryEntry } from '../domain/public/air';
import type { Vec2 } from '../domain/public/geometry';
import { isAntiAir, type WeaponType } from '../domain/public/equipment';
import { cellAtIndex, elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { POI_KINDS, type Poi } from '../domain/public/poi';
import type { ReportLevel } from '../domain/public/radio';
import { rainVisibilityMeters, systemCenterAt, weatherAt, type Weather } from '../domain/public/weather';
import { distanceText, markerSize, scaleBarMeters, strengthText, weaponTag } from './format';
import { contourEdges, hillshade, shadedColor } from './terrain-shading';
import {
  ceilingField,
  chartLevels,
  contourSegments,
  levelFor,
  rainClass,
  stormTracks,
  type CeilingField,
  type ChartLevel,
  type ForecastError,
  type StormTrack,
} from './weather-chart';
import type {
  ContactCluster,
  ContactMarker,
  FriendlyMarkerView,
  PlayerView,
  GroundFireEffect,
  ReachableRegion,
  StrikeEffect,
} from '../knowledge/player-view';

export type Selection =
  | Readonly<{ kind: 'aircraft'; id: string }>
  | Readonly<{ kind: 'friendly'; id: string }>
  | Readonly<{ kind: 'contact'; key: string }>
  | null;

export type MapHit = Exclude<Selection, null>;

export type WeatherLayer = Readonly<{
  forecast: Weather;
  /** The moment being looked at; `now` is where the tracks start. */
  tick: number;
  now: number;
  issuedAt: number;
  altitudeMeters: number;
  error: ForecastError;
  confidence: number;
}>;

export type MapLayers = Readonly<{ weather: WeatherLayer | null; threats: boolean }>;

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
const SCALE_BAR_MAX_PIXELS = 140;
const OVERLAY_MARGIN = 16;
const WEATHER_CELL_METERS = 100;
const TERRAIN_PIXELS_PER_CELL = 4;
const CONTOUR_COLOR = 'rgba(45,30,10,0.28)';
const ANTI_AIR_COLOR = '#ff3df0';
const CLUSTER_MARGIN_METERS = 80;
const BLINK_PERIOD_TICKS = 4;
const FACING_LINE_PIXELS = 14;
const POI_COLOR = '#ffaa3c';
const REPORT_RING_PIXELS = 15;

export class MapView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrainImage: HTMLCanvasElement;
  private readonly weatherImage = document.createElement('canvas');
  private readonly worldSize: number;
  private center: Vec2;
  private zoom = 1;
  private split: ReadonlySet<string> = new Set();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly terrain: TerrainGrid,
    private readonly sensorRadius: (aircraft: AircraftTelemetryEntry) => number,
    private readonly threatRadius: (weapons: readonly WeaponType[], altitudeMeters: number) => number,
    private readonly friendlyStrength: Readonly<Record<string, number>>,
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
    image.width = terrain.width * TERRAIN_PIXELS_PER_CELL;
    image.height = terrain.height * TERRAIN_PIXELS_PER_CELL;
    const context = image.getContext('2d');
    if (context === null) throw new Error('Canvas 2D is unavailable');
    for (let row = 0; row < terrain.height; row += 1) {
      for (let column = 0; column < terrain.width; column += 1) {
        const index = row * terrain.width + column;
        const color = TERRAIN_COLORS[cellAtIndex(terrain, index).terrainClass] ?? '#000000';
        const lift = 0.85 + (terrain.elevation[index] ?? 0) / 1200;
        context.fillStyle = shadedColor(color, lift * hillshade(terrain, column, row));
        context.fillRect(column * TERRAIN_PIXELS_PER_CELL, row * TERRAIN_PIXELS_PER_CELL, TERRAIN_PIXELS_PER_CELL, TERRAIN_PIXELS_PER_CELL);
      }
    }
    context.fillStyle = CONTOUR_COLOR;
    for (let row = 0; row < terrain.height; row += 1) {
      for (let column = 0; column < terrain.width; column += 1) {
        const { east, south } = contourEdges(terrain, column, row);
        const x = (column + 1) * TERRAIN_PIXELS_PER_CELL;
        const y = (row + 1) * TERRAIN_PIXELS_PER_CELL;
        if (east) context.fillRect(x - 1, y - TERRAIN_PIXELS_PER_CELL, 1, TERRAIN_PIXELS_PER_CELL);
        if (south) context.fillRect(x - TERRAIN_PIXELS_PER_CELL, y - 1, TERRAIN_PIXELS_PER_CELL, 1);
      }
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

  showSplit(split: ReadonlySet<string>): void {
    this.split = split;
  }

  /** What the map draws: consolidated markers, except groups the player has split apart. */
  private shownContacts(view: PlayerView): readonly ContactMarker[] {
    return view.contacts.flatMap((marker) =>
      this.split.has(marker.key) ? [{ ...marker, members: [] }, ...marker.members] : [marker],
    );
  }

  /** The ground fire mark under the cursor. Marks are reports, so they aren't selectable. */
  groundFireAt(pixel: Vec2, view: PlayerView): GroundFireEffect | null {
    const near = (fire: GroundFireEffect): boolean => {
      const at = this.toScreen(fire.position);
      return Math.hypot(at.x - pixel.x, at.y - pixel.y) <= HIT_RADIUS_PIXELS;
    };
    return view.groundFire.find(near) ?? null;
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
    for (const marker of this.shownContacts(view)) {
      consider(this.toScreen(marker.contact.position.center), { kind: 'contact', key: marker.key });
    }
    return hits.sort((a, b) => a.gap - b.gap).map(({ hit }) => hit);
  }

  render(view: PlayerView, selection: Selection, threatAltitudeMeters: number, layers: MapLayers): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#10140f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const origin = this.toScreen({ x: 0, y: 0 });
    const size = this.worldSize * this.pixelsPerMeter;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainImage, origin.x, origin.y, size, size);
    this.drawGrid(origin, size);
    if (layers.weather !== null) this.drawWeather(layers.weather);

    const shown = (fade: number, selected: boolean): number => (selected ? Math.max(fade, 0.6) : fade);
    const contacts = this.shownContacts(view);
    if (layers.threats) {
      for (const marker of contacts) this.drawThreatRing(marker, threatAltitudeMeters);
    }
    for (const marker of contacts) {
      const selected = selection?.kind === 'contact' && selection.key === marker.key;
      this.drawRegion(marker.region, shown(marker.regionOpacity, selected), '#ff6b5a');
    }
    for (const friendly of view.friendlies) {
      const selected = selection?.kind === 'friendly' && selection.id === friendly.unitId;
      this.drawRegion(friendly.region, shown(friendly.regionOpacity, selected), '#59a8ff');
    }
    for (const marker of contacts) {
      const selected = selection?.kind === 'contact' && selection.key === marker.key;
      if (selected) this.drawThreatRing(marker, threatAltitudeMeters);
      this.drawContact(marker, selected);
    }
    for (const cluster of view.clusters) this.drawCluster(cluster);
    for (const poi of view.pois) this.drawPoi(poi);
    for (const friendly of view.friendlies) {
      this.drawFriendly(friendly, selection?.kind === 'friendly' && selection.id === friendly.unitId);
    }
    for (const marker of contacts) {
      if (marker.engaging && marker.status !== 'destroyed') this.drawFireRing(marker.contact.position.center, view.tick);
    }
    for (const friendly of view.friendlies) {
      if (friendly.engaging) this.drawFireRing(friendly.position.center, view.tick);
    }
    for (const reporter of view.reporting) {
      const friendly = view.friendlies.find((entry) => entry.unitId === reporter.senderId);
      const point = friendly?.position.center ?? view.aircraft.find((a) => a.aircraftId === reporter.senderId)?.position;
      if (point !== undefined) this.drawReporting(point, reporter.level, view.tick);
    }
    for (const flag of view.ticFlags) {
      if (flag.ageSeconds <= 300) this.drawTic(flag.position.center);
    }
    for (const aircraft of view.aircraft) {
      if (aircraft.status === 'ready' || aircraft.status === 'turnaround') continue;
      this.drawAircraft(aircraft, selection?.kind === 'aircraft' && selection.id === aircraft.aircraftId);
    }
    for (const strike of view.strikes) this.drawStrike(strike, view.aircraft);
    for (const fire of view.groundFire) this.drawGroundFire(fire);
    this.drawScaleBar();
    this.drawNorthArrow();
  }

  /** A forecaster's chart: bands of cloud base at one moment, and where each storm is headed. */
  private drawWeather(layer: WeatherLayer): void {
    const { ctx } = this;
    const { forecast, tick, altitudeMeters } = layer;
    const levels = chartLevels(altitudeMeters, forecast.baseCeilingMeters);
    const field = ceilingField(forecast, tick, this.worldSize, WEATHER_CELL_METERS);
    const origin = this.toScreen({ x: 0, y: 0 });
    const size = this.worldSize * this.pixelsPerMeter;
    ctx.save();
    ctx.beginPath();
    ctx.rect(origin.x, origin.y, size, size);
    ctx.clip();
    this.drawCloudBands(field, levels, layer.confidence);
    for (const level of levels) this.drawContour(field, level);
    this.drawRain(forecast, tick);
    for (const track of stormTracks(forecast, layer.now, layer.issuedAt, altitudeMeters, layer.error)) this.drawTrack(track);
    this.drawCloudBaseLabels(forecast, tick);
    ctx.restore();
  }

  /** Painted small and scaled up, so the bands blend instead of showing the sampling grid. */
  private drawCloudBands(field: CeilingField, levels: readonly ChartLevel[], confidence: number): void {
    const { ctx, weatherImage } = this;
    const { columns, rows, stepMeters, ceilings } = field;
    weatherImage.width = columns;
    weatherImage.height = rows;
    const image = new ImageData(columns, rows);
    for (let index = 0; index < ceilings.length; index += 1) {
      const level = levelFor(ceilings[index] ?? Infinity, levels);
      if (level === null) continue;
      image.data.set([...level.rgb, Math.round(level.alpha * confidence * 255)], index * 4);
    }
    weatherImage.getContext('2d')?.putImageData(image, 0, 0);
    const at = this.toScreen({ x: -stepMeters / 2, y: -stepMeters / 2 });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(weatherImage, at.x, at.y, columns * stepMeters * this.pixelsPerMeter, rows * stepMeters * this.pixelsPerMeter);
    ctx.imageSmoothingEnabled = false;
  }

  private drawContour(field: CeilingField, level: ChartLevel): void {
    const { ctx } = this;
    ctx.strokeStyle = level.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [a, b] of contourSegments(field, level.ceilingMeters)) {
      const [from, to] = [this.toScreen(a), this.toScreen(b)];
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }

  private drawRain(forecast: Weather, tick: number): void {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(205,232,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let row = 0; row * WEATHER_CELL_METERS < this.worldSize; row += 1) {
      for (let column = 0; column * WEATHER_CELL_METERS < this.worldSize; column += 1) {
        const point = { x: (column + 0.5) * WEATHER_CELL_METERS, y: (row + 0.5) * WEATHER_CELL_METERS };
        const rain = rainClass(weatherAt(forecast, point, tick).rain);
        if (rain === null || column % rain.everyCells !== 0 || row % rain.everyCells !== 0) continue;
        const at = this.toScreen(point);
        ctx.moveTo(at.x + rain.lengthPixels / 2, at.y - rain.lengthPixels);
        ctx.lineTo(at.x - rain.lengthPixels / 2, at.y + rain.lengthPixels);
      }
    }
    ctx.stroke();
  }

  /** The likely path, widening with forecast error, with the expected line and times down it. */
  private drawTrack(track: StormTrack): void {
    const { ctx } = this;
    const [from, to] = [this.toScreen(track.from), this.toScreen(track.to)];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 1) return;
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    const [fromWidth, toWidth] = [track.fromHalfWidth * this.pixelsPerMeter, track.toHalfWidth * this.pixelsPerMeter];
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(to.x, to.y, toWidth, heading - Math.PI / 2, heading + Math.PI / 2);
    ctx.arc(from.x, from.y, fromWidth, heading + Math.PI / 2, heading - Math.PI / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    if (track.formsInMinutes > 0) this.drawChartLabel(`forms +${track.formsInMinutes}`, from.x, from.y);
    for (const mark of track.marks) {
      const at = this.toScreen(mark.position);
      this.drawChevron(at.x, at.y, heading);
      this.drawChartLabel(`+${mark.minutes}`, at.x, at.y + 16);
    }
    this.drawChevron(to.x, to.y, heading);
  }

  private drawChevron(x: number, y: number, heading: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawCloudBaseLabels(forecast: Weather, tick: number): void {
    for (const system of forecast.systems) {
      if (tick < system.fromTick || tick > system.untilTick) continue;
      const center = systemCenterAt(system, tick);
      const { ceilingMeters, rain } = weatherAt(forecast, center, tick);
      if (ceilingMeters >= forecast.baseCeilingMeters) continue;
      const at = this.toScreen(center);
      const visibility = Math.round(rainVisibilityMeters(forecast, rain) / 100) * 100;
      this.drawChartLabel(`BASE ${Math.round(ceilingMeters / 10) * 10} m · VIS ${visibility} m`, at.x, at.y - 14);
    }
  }

  private drawChartLabel(text: string, x: number, y: number): void {
    const { ctx } = this;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    const width = ctx.measureText(text).width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - width / 2, y - 7, width, 14);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  private drawScaleBar(): void {
    const { ctx, canvas } = this;
    const meters = scaleBarMeters(this.pixelsPerMeter, SCALE_BAR_MAX_PIXELS);
    const width = meters * this.pixelsPerMeter;
    const left = OVERLAY_MARGIN;
    const y = canvas.height - OVERLAY_MARGIN;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(left - 6, y - 24, width + 12, 34);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, y - 6);
    ctx.lineTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.lineTo(left + width, y - 6);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(distanceText(meters), left + width / 2, y - 9);
    ctx.textAlign = 'left';
  }

  /** The map never rotates and world y grows southward, so north is always up. */
  private drawNorthArrow(): void {
    const { ctx, canvas } = this;
    const x = canvas.width - OVERLAY_MARGIN - 12;
    const y = OVERLAY_MARGIN + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(x, y + 6, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x, y + 2);
    ctx.lineTo(x - 7, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', x, y + 20);
    ctx.textAlign = 'left';
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

  /** A short line the way a still squad was seen to face. It is an observation, not a claim. */
  private drawFacing(marker: ContactMarker, at: Vec2, size: number): void {
    const { facingRad } = marker.contact;
    if (facingRad === undefined) return;
    const { ctx } = this;
    const reach = (size + FACING_LINE_PIXELS) / this.pixelsPerMeter;
    const { center } = marker.contact.position;
    const end = this.toScreen({ x: center.x + Math.cos(facingRad) * reach, y: center.y + Math.sin(facingRad) * reach });
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  private drawPoi(poi: Poi): void {
    const { ctx } = this;
    const at = this.toScreen(poi.center);
    const radius = poi.radiusMeters * this.pixelsPerMeter;
    ctx.strokeStyle = POI_COLOR;
    ctx.fillStyle = 'rgba(255, 170, 60, 0.12)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = POI_COLOR;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(POI_KINDS[poi.kind].label, at.x, at.y + radius + 13);
  }

  /** A dashed ring with a count of reports: distinct from a marker, and never a unit symbol. */
  private drawCluster(cluster: ContactCluster): void {
    const { ctx } = this;
    const at = this.toScreen(cluster.center);
    const radius = (cluster.radiusMeters + CLUSTER_MARGIN_METERS) * this.pixelsPerMeter;
    ctx.strokeStyle = '#ff6b5a';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff6b5a';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${cluster.reports} reports, ${strengthText(cluster.strength)}`, at.x, at.y - radius - 4);
  }

  /** Where the weapons seen on this contact are a real danger to aircraft at their altitude. */
  private drawThreatRing(marker: ContactMarker, altitudeMeters: number): void {
    const { ctx } = this;
    const height = Math.max(0, altitudeMeters - elevationAt(this.terrain, marker.contact.position.center));
    const radius = this.threatRadius(marker.contact.observedWeapons, height) * this.pixelsPerMeter;
    if (radius <= 0) return;
    const at = this.toScreen(marker.contact.position.center);
    ctx.strokeStyle = ANTI_AIR_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawTag(text: string, x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.font = 'bold 11px monospace';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, x, y);
    ctx.lineJoin = 'miter';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /** A red cross at the reported source of ground fire, heavier when it scored a hit. */
  private drawGroundFire(fire: GroundFireEffect): void {
    const { ctx } = this;
    const at = this.toScreen(fire.position);
    const size = fire.hit ? 10 : 7;
    ctx.globalAlpha = fire.opacity;
    const tag = fire.weapon === null ? null : weaponTag([fire.weapon]);
    if (tag !== null) this.drawTag(tag, at.x + size + 3, at.y + 4, ANTI_AIR_COLOR);
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = fire.hit ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(at.x - size, at.y - size);
    ctx.lineTo(at.x + size, at.y + size);
    ctx.moveTo(at.x + size, at.y - size);
    ctx.lineTo(at.x - size, at.y + size);
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
    const size = markerSize(marker.contact.strength);
    ctx.globalAlpha = marker.opacity;
    if (marker.status === 'destroyed') {
      this.drawDestroyed(at, size);
      ctx.globalAlpha = 1;
      return;
    }
    const color = marker.contact.identification === 'hostile' ? '#e8483a' : '#e0b040';
    const hollow = marker.status === 'not-found' || marker.contact.strength.kind === 'unknown';
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? '#ffffff' : hollow ? color : '#000000';
    ctx.lineWidth = selected ? 2.5 : hollow ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - size);
    ctx.lineTo(at.x + size, at.y);
    ctx.lineTo(at.x, at.y + size);
    ctx.lineTo(at.x - size, at.y);
    ctx.closePath();
    if (!hollow) ctx.fill();
    ctx.stroke();
    if (marker.status === 'hit') this.drawHitTick(at, size);
    this.drawFacing(marker, at, size);
    const weapons = marker.contact.observedWeapons;
    const antiAir = weapons.some(isAntiAir);
    if (antiAir) {
      ctx.strokeStyle = ANTI_AIR_COLOR;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(at.x - 8, at.y - size - 3);
      ctx.lineTo(at.x, at.y - size - 11);
      ctx.lineTo(at.x + 8, at.y - size - 3);
      ctx.stroke();
    }
    const tag = weaponTag(weapons);
    if (tag !== null) this.drawTag(tag, at.x + size + 4, at.y + 4, antiAir ? ANTI_AIR_COLOR : '#ffffff');
    if (marker.members.length > 0) {
      this.drawTag(`×${marker.members.length + 1}`, at.x + size + 4, at.y - size, '#ffffff');
    }
    ctx.globalAlpha = 1;
  }

  private drawHitTick(at: Vec2, size: number): void {
    const { ctx } = this;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at.x - size / 2, at.y + size / 2);
    ctx.lineTo(at.x + size / 2, at.y - size / 2);
    ctx.stroke();
  }

  private drawDestroyed(at: Vec2, size: number): void {
    const { ctx } = this;
    ctx.strokeStyle = '#b8b8b8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(at.x - size, at.y - size);
    ctx.lineTo(at.x + size, at.y + size);
    ctx.moveTo(at.x + size, at.y - size);
    ctx.lineTo(at.x - size, at.y + size);
    ctx.stroke();
  }

  private drawFriendly(friendly: FriendlyMarkerView, selected: boolean): void {
    const { ctx } = this;
    const at = this.toScreen(friendly.position.center);
    const personnel = friendly.statusReport?.personnel ?? this.friendlyStrength[friendly.unitId] ?? 0;
    const width = personnel <= 14 ? 12 : personnel <= 50 ? 18 : 24;
    const height = (width * 2) / 3;
    ctx.globalAlpha = friendly.opacity;
    ctx.fillStyle = '#3f8fe8';
    ctx.strokeStyle = selected ? '#ffffff' : friendly.silent ? '#ffd24a' : '#000000';
    ctx.lineWidth = selected ? 2.5 : friendly.silent ? 2 : 1;
    if (friendly.silent) ctx.setLineDash([3, 3]);
    else ctx.fillRect(at.x - width / 2, at.y - height / 2, width, height);
    ctx.strokeRect(at.x - width / 2, at.y - height / 2, width, height);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Blinks, so the eye finds who just spoke. Urgent senders blink red. */
  private drawReporting(point: Vec2, level: ReportLevel, tick: number): void {
    if (tick % BLINK_PERIOD_TICKS >= BLINK_PERIOD_TICKS / 2) return;
    const { ctx } = this;
    const at = this.toScreen(point);
    ctx.strokeStyle = level === 'urgent' ? '#ff4d4d' : '#ffffff';
    ctx.globalAlpha = level === 'routine' ? 0.5 : 1;
    ctx.lineWidth = level === 'urgent' ? 3 : 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, REPORT_RING_PIXELS, 0, Math.PI * 2);
    ctx.stroke();
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
    return order === null || order.kind === 'ReturnToBase' ? null : order.center;
  }

  /** A body with a rotor bar, so a helicopter reads differently from any swept-wing shape. */
  private drawHelicopter(aircraft: AircraftTelemetryEntry, at: Vec2, color: string, selected: boolean): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(aircraft.headingRad);
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? '#ffffff' : '#000000';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.moveTo(-5, 0);
    ctx.lineTo(-15, 0);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-11, -9);
    ctx.lineTo(11, 9);
    ctx.moveTo(-11, 9);
    ctx.lineTo(11, -9);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(aircraft.aircraftId, at.x + 14, at.y + 4);
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

    if (aircraft.rotary) {
      this.drawHelicopter(aircraft, at, color, selected);
      return;
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
