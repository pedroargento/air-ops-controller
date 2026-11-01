import { qualifiesForSupport, type AircraftId, type AircraftOrder, type AircraftTelemetryEntry } from '../domain/public/air';
import type { PlayerAction, ReportRequest } from '../domain/public/commands';
import type { Debrief } from '../domain/public/debrief';
import type { WeaponType } from '../domain/public/equipment';
import type { Vec2 } from '../domain/public/geometry';
import { elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { weatherAt } from '../domain/public/weather';
import type { ContactMarker, FriendlyMarkerView, PlayerView } from '../knowledge/player-view';
import {
  aircraftMission,
  aircraftSummary,
  clock,
  cursorGrid,
  displayName,
  forwardPreview,
  gridRef,
  forceRatioText,
  groundFireText,
  radioLine,
  rangeText,
  statusText,
  strengthText,
  triage,
  weaponsText,
  type ContactMemory,
  type Names,
  type TriageParameters,
} from './format';
import { AltitudeProfile } from './altitude-profile';
import { PathProfile } from './path-profile';
import { summarizeBattle, type BattleSummary, type SummaryConfig } from './battle-summary';
import { MapView, type Selection, type WeatherLayer } from './map-view';
import { ToastQueue } from './toasts';
import { morphHtml } from './morph';
import { stormMovement, type ForecastError } from './weather-chart';

type AreaOrderKind = 'MoveTo' | 'Orbit' | 'ReconArea' | 'SupportArea';

export type UiConfig = Readonly<{
  terrain: TerrainGrid;
  names: Names;
  recipients: readonly string[];
  objective: string;
  ackDistanceMeters: number;
  sensorRadius: (aircraft: AircraftTelemetryEntry) => number;
  threatRadius: (weapons: readonly WeaponType[], altitudeMeters: number) => number;
  weaponCeiling: (weapon: WeaponType) => number;
  maxAltitudeMeters: number;
  defaultAltitudeMeters: number;
  summary: SummaryConfig;
  triage: TriageParameters;
  durationSeconds: number;
  forecastError: ForecastError;
  speeds: readonly number[];
  onAction: (action: PlayerAction) => void;
  onSpeed: (speed: number) => void;
  onTogglePause: () => void;
  onExportLog: () => void;
}>;

export type RunState = Readonly<{ paused: boolean; speed: number; result: string | null; debrief: Debrief | null }>;

const DEFAULT_RADIUS: Readonly<Record<AreaOrderKind, number>> = {
  MoveTo: 0,
  Orbit: 500,
  ReconArea: 1000,
  SupportArea: 500,
};

const ORDER_LABELS: Readonly<Record<AreaOrderKind, string>> = {
  MoveTo: 'Move to',
  Orbit: 'Orbit',
  ReconArea: 'Recon area',
  SupportArea: 'Support area',
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing element ${id}`);
  return found as T;
}

const FORECAST_STEP_SECONDS = 300;
const FORECAST_CONFIDENCE_SECONDS = 1800;

function visibilityText(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 50) * 50} m`;
}

function aircraftDestination(aircraft: AircraftTelemetryEntry): Vec2 | null {
  const { order } = aircraft;
  if (order === null || order.kind === 'ReturnToBase') return null;
  return order.kind === 'MoveTo' || order.kind === 'Orbit' ? order.point : order.center;
}

function findContact(view: PlayerView, key: string): ContactMarker | undefined {
  return view.contacts.flatMap((marker) => [marker, ...marker.members]).find((marker) => marker.key === key);
}

/** The one place the truth appears, once the run is over: what really happened against the estimates. */
function debriefHtml(debrief: Debrief, summary: BattleSummary): string {
  const enemyLost = debrief.enemyStart - debrief.enemyLeft;
  return (
    `<h3>Debrief: what really happened</h3>` +
    `<p>Enemy: ${debrief.enemyStart} at start, ${debrief.enemyLeft} left. ${enemyLost} lost, against your estimate of ${rangeText(summary.losses)}.</p>` +
    `<p>Formations: ${debrief.enemyFormations}, of which ${debrief.enemyDestroyed} destroyed and ${debrief.enemyBroken} broken.</p>` +
    `<p>Friendly: ${debrief.friendlyStart} at start, ${debrief.friendlyLeft} left, ${debrief.friendlyDestroyed} formations lost.</p>`
  );
}

export class App {
  private readonly map: MapView;
  private readonly tooltip = element('tooltip');
  private readonly cursorGrid = element('cursor-grid');
  private readonly log = element('radio-log');
  private selection: Selection = null;
  private lastAircraftId: string | null = null;
  private readonly split = new Set<string>();
  private sideTab: 'radio' | 'summary' = 'radio';
  private radioFilter: 'main' | 'all' = 'main';
  private heardContacts: readonly ContactMemory[] = [];
  private readonly toasts = new ToastQueue();
  private lastFrameAt: number | null = null;
  private readonly layers = new Set<'weather' | 'threats'>();
  private forecastLeadSeconds = 0;
  private readonly profile: AltitudeProfile;
  private readonly pathProfile: PathProfile;
  private pendingOrder: Readonly<{ aircraftId: AircraftId; kind: AreaOrderKind }> | null = null;
  private recipients = new Set<string>();
  private view: PlayerView | null = null;
  private logged = 0;
  private dragFrom: Vec2 | null = null;
  private dragged = false;

  constructor(private readonly config: UiConfig) {
    const canvas = element<HTMLCanvasElement>('map');
    this.map = new MapView(canvas, config.terrain, config.sensorRadius, config.threatRadius, config.summary.friendlyStrength);
    this.pathProfile = new PathProfile(element<HTMLCanvasElement>('path-profile'), config.terrain);
    this.profile = new AltitudeProfile(element<HTMLCanvasElement>('altitude-profile'), {
      maxAltitudeMeters: config.maxAltitudeMeters,
      weaponCeiling: config.weaponCeiling,
      groundAt: (point) => elevationAt(config.terrain, point),
      onSelect: (id) => this.select({ kind: 'aircraft', id }),
      onSetAltitude: (aircraftId, meters) => config.onAction({ kind: 'setAltitude', aircraftId, meters }),
    });
    this.fitCanvas();
    // Watches the holder, not the window: the header's height isn't known until it first renders.
    new ResizeObserver(() => this.fitCanvas()).observe(element('map-holder'));
    this.bindMap(canvas);
    element('forecast-lead').addEventListener('input', (event) => {
      this.forecastLeadSeconds = Number((event.target as HTMLInputElement).value);
    });
    for (const panel of ['controls', 'aircraft', 'selection', 'requests', 'radio-log', 'side-tabs', 'map-layers', 'forecast', 'map-toasts']) {
      element(panel).addEventListener('click', (event) => this.onPanelClick(event));
      element(panel).addEventListener('change', (event) => this.onPanelChange(event));
    }
  }

  private fitCanvas(): void {
    const holder = element('map-holder');
    this.map.resize(holder.clientWidth, holder.clientHeight);
  }

  private bindMap(canvas: HTMLCanvasElement): void {
    const pixel = (event: MouseEvent): Vec2 => ({ x: event.offsetX, y: event.offsetY });
    canvas.addEventListener('mousedown', (event) => {
      this.dragFrom = pixel(event);
      this.dragged = false;
    });
    canvas.addEventListener('mousemove', (event) => {
      if (this.dragFrom !== null && event.buttons === 1) {
        const at = pixel(event);
        const dx = at.x - this.dragFrom.x;
        const dy = at.y - this.dragFrom.y;
        if (this.dragged || Math.hypot(dx, dy) > 4) {
          this.dragged = true;
          this.map.panBy(dx, dy);
          this.dragFrom = at;
        }
      }
      this.updateTooltip(pixel(event));
      this.updateCursorGrid(pixel(event));
    });
    canvas.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      this.cursorGrid.style.display = 'none';
    });
    canvas.addEventListener('mouseup', (event) => {
      this.dragFrom = null;
      if (!this.dragged) this.onMapClick(pixel(event));
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.map.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
  }

  private onMapClick(pixel: Vec2): void {
    const pending = this.pendingOrder;
    if (pending !== null) {
      this.config.onAction({
        kind: 'aircraftOrder',
        aircraftId: pending.aircraftId,
        order: this.buildOrder(pending.kind, this.map.toWorld(pixel)),
      });
      this.pendingOrder = null;
      return;
    }
    if (this.view === null) return;
    const hits = this.map.hitsAt(pixel, this.view);
    // Clicking again on overlapping markers moves on to the next one.
    const current = hits.findIndex((hit) => JSON.stringify(hit) === JSON.stringify(this.selection));
    this.select(hits[(current + 1) % hits.length] ?? null);
  }

  private buildOrder(kind: AreaOrderKind, point: Vec2): AircraftOrder {
    const input = document.getElementById('order-radius') as HTMLInputElement | null;
    const typed = Number(input?.value ?? 0);
    const radius = typed > 0 ? typed : DEFAULT_RADIUS[kind];
    switch (kind) {
      case 'MoveTo':
        return { kind, point };
      case 'Orbit':
        return { kind, point, radius };
      case 'ReconArea':
      case 'SupportArea':
        return { kind, center: point, radius };
    }
  }

  private select(selection: Selection): void {
    if (selection?.kind === 'aircraft') this.lastAircraftId = selection.id;
    this.selection = selection;
    this.recipients = new Set();
    this.pendingOrder = null;
  }

  private toggleLayer(layer: 'weather' | 'threats'): void {
    if (!this.layers.delete(layer)) this.layers.add(layer);
    if (layer === 'weather') this.setForecastLead(0);
  }

  private setForecastLead(seconds: number): void {
    this.forecastLeadSeconds = seconds;
    element<HTMLInputElement>('forecast-lead').value = String(seconds);
  }

  /** Rounded to the slider's steps, because a forecast isn't that exact. */
  private etaOfSelected(): number {
    const view = this.view;
    const aircraft = view === null ? null : this.threatAircraft(view);
    return Math.round((aircraft?.etaSeconds ?? 0) / FORECAST_STEP_SECONDS) * FORECAST_STEP_SECONDS;
  }

  private weatherLayer(view: PlayerView): WeatherLayer | null {
    if (!this.layers.has('weather') || view.forecast === null) return null;
    const confidence = 1 / (1 + this.forecastLeadSeconds / FORECAST_CONFIDENCE_SECONDS);
    return {
      forecast: view.forecast,
      tick: view.tick + this.forecastLeadSeconds,
      now: view.tick,
      issuedAt: view.forecastIssuedAt ?? view.tick,
      altitudeMeters: this.threatAltitude(view),
      error: this.config.forecastError,
      confidence,
    };
  }

  /** Cloud base where it matters: over the selected aircraft, or else the objective. */
  private forecastCeiling(view: PlayerView): number | null {
    if (!this.layers.has('weather') || view.forecast === null) return null;
    const point = this.threatAircraft(view)?.position ?? this.config.summary.objective;
    return weatherAt(view.forecast, point, view.tick + this.forecastLeadSeconds).ceilingMeters;
  }

  private renderLayers(view: PlayerView): void {
    const button = (id: 'weather' | 'threats', label: string): string =>
      `<button data-action="layer" data-id="${id}"${this.layers.has(id) ? ' class="active"' : ''}>${label}</button>`;
    morphHtml(element('map-layers'), button('weather', 'Weather') + button('threats', 'Threats'));
    const shown = this.layers.has('weather');
    element('forecast').hidden = !shown;
    if (!shown) return;
    const remaining = Math.max(0, this.config.durationSeconds - view.tick);
    if (this.forecastLeadSeconds > remaining) this.setForecastLead(remaining);
    element<HTMLInputElement>('forecast-lead').max = String(remaining);
    const issued = view.forecastIssuedAt === null ? 'no forecast yet' : `issued ${clock(view.forecastIssuedAt)}`;
    const at = this.forecastLeadSeconds === 0 ? 'Now' : `+${Math.round(this.forecastLeadSeconds / 60)} min, ${clock(view.tick + this.forecastLeadSeconds)}`;
    const movement = view.forecast === null ? null : (stormMovement(view.forecast) ?? 'no storms forecast');
    element('forecast-label').textContent = [at, issued, movement].filter((part) => part !== null).join(' · ');
    element('forecast-altitude').textContent = `${Math.round(this.threatAltitude(view))} m`;
  }

  /** The threat ring is for the aircraft the player is thinking about: the last one selected. */
  /** For the browser check: where an aircraft's column is on the profile. */
  profileColumn(id: string): number | null {
    return this.profile.columnPixel(id);
  }

  private threatAircraft(view: PlayerView): AircraftTelemetryEntry | null {
    return view.aircraft.find((a) => a.aircraftId === this.lastAircraftId) ?? null;
  }

  private threatAltitude(view: PlayerView): number {
    const aircraft = this.threatAircraft(view);
    if (aircraft === null) return this.config.defaultAltitudeMeters;
    return aircraft.altitudeMeters > 0 ? aircraft.altitudeMeters : aircraft.targetAltitudeMeters;
  }

  private onPanelChange(event: Event): void {
    const input = event.target as HTMLElement;
    if (input.id === 'order-altitude' && input instanceof HTMLInputElement && this.selection?.kind === 'aircraft') {
      const aircraftId = this.selection.id as AircraftId;
      this.config.onAction({ kind: 'setAltitude', aircraftId, meters: Number(input.value) });
      return;
    }
    const recipient = input.dataset['recipient'];
    if (recipient === undefined || !(input instanceof HTMLInputElement)) return;
    if (input.checked) this.recipients.add(recipient);
    else this.recipients.delete(recipient);
  }

  private onPanelClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (target === null) return;
    const { action, id, kind, x, y } = target.dataset;
    switch (action) {
      case 'pause':
        this.config.onTogglePause();
        return;
      case 'layer':
        this.toggleLayer(id === 'weather' ? 'weather' : 'threats');
        return;
      case 'forecast-now':
        this.setForecastLead(0);
        return;
      case 'forecast-eta':
        this.setForecastLead(this.etaOfSelected());
        return;
      case 'tab':
        this.sideTab = id === 'summary' ? 'summary' : 'radio';
        return;
      case 'radio-filter':
        this.radioFilter = id === 'all' ? 'all' : 'main';
        return;
      case 'split':
        if (id !== undefined) this.split.add(id);
        this.map.showSplit(this.split);
        return;
      case 'speed':
        this.config.onSpeed(Number(id));
        return;
      case 'export':
        this.config.onExportLog();
        return;
      case 'select-aircraft':
        this.select({ kind: 'aircraft', id: id ?? '' });
        return;
      case 'select-friendly':
        this.select({ kind: 'friendly', id: id ?? '' });
        return;
      case 'center':
        this.map.centerOn({ x: Number(x), y: Number(y) });
        return;
      case 'toast':
        if (x !== undefined && y !== undefined) this.map.centerOn({ x: Number(x), y: Number(y) });
        this.toasts.dismiss(Number(id));
        return;
      case 'order':
        if (this.selection?.kind === 'aircraft') {
          this.pendingOrder = { aircraftId: this.selection.id as AircraftId, kind: kind as AreaOrderKind };
        }
        return;
      case 'rtb':
        if (this.selection?.kind === 'aircraft') {
          this.config.onAction({
            kind: 'aircraftOrder',
            aircraftId: this.selection.id as AircraftId,
            order: { kind: 'ReturnToBase' },
          });
        }
        return;
      case 'request':
        this.config.onAction({ kind: 'requestReport', unitId: id ?? '', report: kind as ReportRequest });
        return;
      case 'ack':
        this.config.onAction({
          kind: 'acknowledge',
          unitId: id ?? '',
          casAircraftId: kind === undefined || kind === '' ? null : (kind as AircraftId),
        });
        return;
      case 'forward':
        if (this.selection?.kind === 'contact' && this.recipients.size > 0) {
          this.config.onAction({
            kind: 'forwardContact',
            contactKey: this.selection.key,
            recipients: [...this.recipients].sort(),
          });
          this.recipients = new Set();
        }
        return;
    }
  }

  private updateCursorGrid(pixel: Vec2): void {
    const { terrain } = this.config;
    const point = this.map.toWorld(pixel);
    const text = cursorGrid(point, terrain.width * terrain.cellSize, terrain.cellSize);
    this.cursorGrid.textContent = text === null ? null : `${text} · ${elevationAt(terrain, point)} m`;
    this.cursorGrid.style.display = text === null ? 'none' : 'block';
  }

  private updateTooltip(pixel: Vec2): void {
    const view = this.view;
    const hit = view === null ? null : (this.map.hitsAt(pixel, view)[0] ?? null);
    const fire = view === null ? null : this.map.groundFireAt(pixel, view);
    const text =
      view === null
        ? null
        : hit !== null
          ? this.tooltipText(hit, view)
          : fire !== null
            ? groundFireText(fire, this.config.terrain.cellSize)
            : null;
    if (text === null) {
      this.tooltip.style.display = 'none';
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${pixel.x + 16}px`;
    this.tooltip.style.top = `${pixel.y + 16}px`;
  }

  private tooltipText(hit: Exclude<Selection, null>, view: PlayerView): string | null {
    const { names, terrain } = this.config;
    if (hit.kind === 'contact') {
      const marker = findContact(view, hit.key);
      if (marker === undefined) return null;
      const { contact } = marker;
      return [
        `${contact.identification} ${contact.activity}`,
        `Source: ${displayName(contact.provenance.sourceId, names)} (${marker.viaAircraft ? 'aircraft-observed' : 'reported'})`,
        `Observed ${clock(contact.position.observedAt)}, ${marker.ageSeconds}s ago`,
        `${strengthText(contact.strength)}, ${contact.confidence} confidence`,
        weaponsText(contact.observedWeapons),
        ...(marker.members.length > 0 ? [`${marker.members.length + 1} reports consolidated`] : []),
        ...(statusText(marker.status, marker.estimatedLosses) === null ? [] : [statusText(marker.status, marker.estimatedLosses) as string]),
        `Grid ${gridRef(contact.position.center, terrain.cellSize)}`,
      ].join('\n');
    }
    if (hit.kind === 'friendly') {
      const marker = view.friendlies.find((f) => f.unitId === hit.id);
      if (marker === undefined) return null;
      return [
        displayName(marker.unitId, names),
        `Position ${marker.source === 'aircraft' ? 'aircraft-observed' : 'self-reported'}`,
        `Observed ${clock(marker.position.observedAt)}, ${marker.ageSeconds}s ago`,
        `Grid ${gridRef(marker.position.center, terrain.cellSize)}`,
      ].join('\n');
    }
    return hit.id;
  }

  update(view: PlayerView, run: RunState): void {
    this.view = view;
    this.map.render(view, this.selection, this.threatAltitude(view), {
      weather: this.weatherLayer(view),
      threats: this.layers.has('threats'),
    });
    this.renderControls(view, run);
    this.renderAircraft(view);
    this.renderRequests(view);
    this.renderSelection(view);
    this.renderLog(view);
    this.renderToasts(run);
    this.renderSideTab(view, run);
    this.renderLayers(view);
    element('map-holder').classList.toggle('picking', this.pendingOrder !== null);
  }

  private renderControls(view: PlayerView, run: RunState): void {
    const speeds = this.config.speeds
      .map((speed) => {
        const active = speed === run.speed ? ' class="active"' : '';
        return `<button data-action="speed" data-id="${speed}"${active}>${speed}×</button>`;
      })
      .join('');
    const status = run.result ?? (run.paused ? 'PAUSED' : 'RUNNING');
    morphHtml(
      element('controls'),
      `<button id="pause" data-action="pause">${run.paused ? 'Resume' : 'Pause'}</button>${speeds}` +
        `<span id="clock">${clock(view.tick)}</span><span id="status">${escapeHtml(status)}</span>` +
        `<span id="objective">${escapeHtml(this.config.objective)}</span>` +
        `<button data-action="export">Export log</button>`,
    );
  }

  private renderAircraft(view: PlayerView): void {
    const rows = view.aircraft.map((a) => {
      const selected = this.selection?.kind === 'aircraft' && this.selection.id === a.aircraftId;
      const eta = a.etaSeconds === null ? '' : ` ${clock(Math.ceil(a.etaSeconds))}`;
      return (
        `<button class="aircraft-row${selected ? ' active' : ''}" data-action="select-aircraft" data-id="${a.aircraftId}" title="${escapeHtml(aircraftSummary(a))}">` +
        `<b>${a.aircraftId}</b><b>${a.damaged ? 'DAMAGED' : a.status}</b>` +
        `<span class="mission">${aircraftMission(a)}${eta}</span>` +
        `<span>${Math.round(a.altitudeMeters)} m${a.aboveCloud ? ' ☁' : ''}</span><span>${Math.round(a.fuelFraction * 100)}%</span><span>ord ${a.ammunition}</span></button>`
      );
    });
    morphHtml(element('aircraft'), rows.join(''));
    const selected = this.selection?.kind === 'aircraft' ? this.selection.id : null;
    this.profile.render(view, selected, this.forecastCeiling(view));
    const aircraft = view.aircraft.find((a) => a.aircraftId === selected) ?? null;
    this.pathProfile.render(aircraft, aircraft === null ? null : aircraftDestination(aircraft));
  }

  private renderRequests(view: PlayerView): void {
    const pending = view.supportRequests.filter((r) => !r.acknowledged);
    const rows = pending.map(
      (r) =>
        `<button data-action="select-friendly" data-id="${escapeHtml(r.unitId)}">${escapeHtml(displayName(r.unitId, this.config.names))}</button>`,
    );
    morphHtml(element('requests'), `<h2>Support requests</h2>${rows.join('') || '<p>None pending</p>'}`);
  }

  private threatLine(weapons: readonly WeaponType[]): string {
    const view = this.view;
    if (view === null || this.config.threatRadius(weapons, 0) <= 0) return '';
    const altitude = Math.round(this.threatAltitude(view));
    const who = this.threatAircraft(view)?.aircraftId ?? 'default altitude';
    return `<p>Threat ring for ${escapeHtml(who)} at ${altitude} m</p>`;
  }

  private renderSelection(view: PlayerView): void {
    const selection = this.selection;
    const panel = element('selection');
    if (selection === null) {
      morphHtml(panel, '<h2>Selected</h2><p>Select an aircraft, unit or contact.</p>');
    } else if (selection.kind === 'aircraft') {
      const aircraft = view.aircraft.find((a) => a.aircraftId === selection.id);
      if (aircraft !== undefined) morphHtml(panel, this.aircraftPanel(aircraft));
    } else if (selection.kind === 'friendly') {
      morphHtml(panel, this.friendlyPanel(selection.id, view));
    } else {
      const marker = findContact(view, selection.key);
      morphHtml(panel, marker === undefined ? '<h2>Selected</h2><p>Contact no longer held.</p>' : this.contactPanel(marker));
    }
  }

  private aircraftPanel(aircraft: AircraftTelemetryEntry): string {
    const kinds: readonly AreaOrderKind[] =
      aircraft.aircraftType === 'cas' ? ['MoveTo', 'Orbit', 'SupportArea'] : ['MoveTo', 'Orbit', 'ReconArea'];
    const buttons = kinds
      .map((kind) => {
        const picking = this.pendingOrder?.kind === kind;
        return `<button data-action="order" data-kind="${kind}"${picking ? ' class="active"' : ''}>${ORDER_LABELS[kind]}</button>`;
      })
      .join('');
    const hint = this.pendingOrder === null ? '' : '<p class="hint">Click the map to set the point.</p>';
    const radiusField = document.getElementById('order-radius') as HTMLInputElement | null;
    const radius = radiusField?.value ?? '500';
    const altitudeField = document.getElementById('order-altitude') as HTMLInputElement | null;
    const editing = altitudeField !== null && document.activeElement === altitudeField;
    const altitude = editing ? altitudeField.value : String(aircraft.targetAltitudeMeters);
    return (
      `<h2>${aircraft.aircraftId} · ${escapeHtml(aircraft.model)}</h2><p>${aircraft.status} · ${aircraft.order?.kind ?? 'no mission'}` +
      `${aircraft.casPhase === null ? '' : ` · ${aircraft.casPhase}`}</p>` +
      `<p>Fuel ${Math.round(aircraft.fuelFraction * 100)}% · ordnance ${aircraft.ammunition} · altitude ${Math.round(aircraft.altitudeMeters)} m · visibility ${visibilityText(aircraft.visibilityMeters)}${aircraft.damaged ? ' · damaged, returning for repair' : ''}${aircraft.aboveCloud ? ' · above cloud, cannot see the ground' : ''}</p>` +
      `<label>Radius (m) <input id="order-radius" type="number" value="${radius}" min="100" step="100" /></label> ` +
      `<label>Altitude (m) <input id="order-altitude" type="number" value="${altitude}" min="100" step="100" /></label>` +
      `<div class="buttons">${buttons}<button data-action="rtb">Return to base</button></div>${hint}`
    );
  }

  private friendlyPanel(unitId: string, view: PlayerView): string {
    const { names, ackDistanceMeters, terrain } = this.config;
    const marker: FriendlyMarkerView | undefined = view.friendlies.find((f) => f.unitId === unitId);
    const name = escapeHtml(displayName(unitId, names));
    const position =
      marker === undefined
        ? '<p>No position report.</p>'
        : `<p>Last reported grid ${gridRef(marker.position.center, terrain.cellSize)}, ${marker.ageSeconds}s ago.</p>`;
    const history = view.log
      .filter((m) => m.senderId === unitId)
      .slice(-4)
      .map((m) => `<li>${clock(m.receivedAt)} ${escapeHtml(radioLine(m, terrain.cellSize).text)}</li>`)
      .join('');
    const inbound = view.aircraft
      .filter((a) => qualifiesForSupport(a, marker?.position.center, ackDistanceMeters))
      .map(
        (a) =>
          `<button data-action="ack" data-id="${escapeHtml(unitId)}" data-kind="${a.aircraftId}">` +
          `${a.aircraftId} inbound${a.etaSeconds === null ? '' : `, ETA ${clock(Math.ceil(a.etaSeconds))}`}</button>`,
      )
      .join('');
    const id = escapeHtml(unitId);
    return (
      `<h2>${name}</h2>${position}<div class="buttons">` +
      `<button data-action="request" data-id="${id}" data-kind="position">Request position</button>` +
      `<button data-action="request" data-id="${id}" data-kind="sitrep">Request SITREP</button>` +
      `<button data-action="request" data-id="${id}" data-kind="contact">Request contact update</button>` +
      `<button data-action="ack" data-id="${id}" data-kind="">Acknowledge</button>${inbound}</div>` +
      `<ul class="history">${history}</ul>`
    );
  }

  private contactHistory(marker: ContactMarker): string {
    const status = statusText(marker.status, marker.estimatedLosses);
    const sources = marker.members.map((m) => displayName(m.contact.provenance.sourceId, this.config.names));
    const merged =
      marker.members.length === 0
        ? ''
        : `<p>Consolidated with ${marker.members.length} other ${marker.members.length === 1 ? 'report' : 'reports'}: ${escapeHtml(sources.join(', '))}</p>` +
          `<button data-action="split" data-id="${escapeHtml(marker.key)}">Split reports</button>`;
    return `${status === null ? '' : `<p>${escapeHtml(status)}</p>`}${merged}`;
  }

  private contactPanel(marker: ContactMarker): string {
    const { names, recipients, terrain } = this.config;
    const { contact } = marker;
    const boxes = recipients
      .map((id) => {
        const checked = this.recipients.has(id) ? ' checked' : '';
        return `<label class="recipient"><input type="checkbox" data-recipient="${escapeHtml(id)}"${checked} />${escapeHtml(displayName(id, names))}</label>`;
      })
      .join('');
    const preview = forwardPreview(marker, [...this.recipients].sort(), names, terrain.cellSize);
    return (
      `<h2>Contact ${escapeHtml(contact.contactId)}</h2>` +
      `<p>${marker.viaAircraft ? 'Air observation' : 'Ground report'} · ${escapeHtml(displayName(contact.provenance.sourceId, names))}</p>` +
      `<p>Grid ${gridRef(contact.position.center, terrain.cellSize)} · ${strengthText(contact.strength)} · ${contact.identification}</p>` +
      `<p>${contact.confidence} confidence · observed ${clock(contact.position.observedAt)}</p>` +
      `<p>${weaponsText(contact.observedWeapons)}</p>` +
      this.contactHistory(marker) +
      this.threatLine(contact.observedWeapons) +
      `<h3>Forward intelligence to</h3>${boxes}<p class="preview">${escapeHtml(preview)}</p>` +
      `<button id="transmit" data-action="forward">Transmit</button>`
    );
  }

  private renderSideTab(view: PlayerView, run: RunState): void {
    const showing = this.sideTab;
    element('radio-log').hidden = showing !== 'radio';
    element('radio-log').classList.toggle('main-only', this.radioFilter === 'main');
    const filter = (id: 'main' | 'all', label: string): string =>
      `<button data-action="radio-filter" data-id="${id}"${this.radioFilter === id ? ' class="active"' : ''}>${label}</button>`;
    element('summary').hidden = showing !== 'summary';
    morphHtml(
      element('side-tabs'),
      `<button data-action="tab" data-id="radio"${showing === 'radio' ? ' class="active"' : ''}>Radio</button>` +
        `<button data-action="tab" data-id="summary"${showing === 'summary' ? ' class="active"' : ''}>Summary</button>` +
        (showing === 'radio' ? `<span class="radio-filter">${filter('main', 'Main')}${filter('all', 'All')}</span>` : ''),
    );
    if (showing === 'summary') morphHtml(element('summary'), this.summaryHtml(view, run));
  }

  private summaryHtml(view: PlayerView, run: RunState): string {
    const summary = summarizeBattle(view, this.config.summary);
    const { names } = this.config;
    const sectors = summary.sectors
      .map(
        (s) =>
          `<tr><td>${s.name}</td><td>${rangeText(s.strength)}</td><td>${s.activity}</td>` +
          `<td>${Math.round(s.ageSeconds / 60)}m${s.stale ? ' ⚠' : ''}</td></tr>`,
      )
      .join('');
    const friendlies = summary.friendlies
      .map((f) => {
        const ammo = f.ammunitionPercent === null ? '' : ` · ammo ${f.ammunitionPercent}%`;
        const state = f.silent ? ` · no contact ${Math.round(f.ageSeconds / 60)}m ⚠` : '';
        const source = f.fromReport ? '' : ' (start)';
        return `<li>${escapeHtml(displayName(f.unitId, names))}: ${f.personnel}${source}${ammo}${state}</li>`;
      })
      .join('');
    const ratio = forceRatioText(summary.threatened, summary.defenders);
    const threats = summary.airThreats.map((t) => `${t.weapons} (${t.sector})`).join(', ');
    return (
      `<h3>Enemy, as reported at ${clock(view.tick)}</h3>` +
      `<p>Known forces: ${summary.groups} groups, est. ${rangeText(summary.known)}` +
      `${summary.unconfirmed > 0 ? ` (${summary.unconfirmed} reports unconfirmed)` : ''}</p>` +
      `<p>HQ estimate at start: about ${summary.hqEstimate}</p>` +
      `<p>Reported losses: est. ${rangeText(summary.losses)} · ${summary.confirmedDestroyed} confirmed destroyed</p>` +
      `<p>Unlocated: est. ${rangeText(summary.unlocated)}</p>` +
      (sectors === '' ? '' : `<table>${sectors}</table>`) +
      `<p>Air threat: ${threats === '' ? 'none observed' : escapeHtml(threats)}</p>` +
      `<h3>Friendly, last reported</h3><ul>${friendlies}</ul>` +
      `<h3>${escapeHtml(this.config.summary.areaLabel)}</h3><p>Within ${this.config.summary.ratioRadiusMeters / 1000} km: enemy ${rangeText(summary.threatened)} ` +
      `against ${summary.defenders} defenders${ratio === null ? '' : ` (${ratio})`}</p>` +
      `<h3>Air</h3><p>${summary.strikes} strikes · ${summary.aircraftHits} hits taken · ${summary.damagedNow} damaged now</p>` +
      `<p class="hint-quiet">${summary.archived} old reports archived; they remain in the radio log.</p>` +
      (run.debrief === null ? '' : debriefHtml(run.debrief, summary))
    );
  }

  private renderLog(view: PlayerView): void {
    const { names, terrain } = this.config;
    for (const message of view.log.slice(this.logged)) {
      const line = radioLine(message, terrain.cellSize);
      const row = document.createElement('div');
      const { level, heard } = triage(message, this.heardContacts, this.config.triage);
      this.heardContacts = heard;
      row.className = `log-row ${message.kind.toLowerCase()} ${level}`;
      if (level !== 'routine') {
        this.toasts.add({
          senderId: message.senderId,
          level,
          sender: displayName(message.senderId, names),
          text: line.text,
          point: line.coordinates.at(-1) ?? null,
        });
      }
      const links = line.coordinates
        .map(
          (point) =>
            `<button class="coord" data-action="center" data-x="${point.x}" data-y="${point.y}">${gridRef(point, terrain.cellSize)}</button>`,
        )
        .join('');
      row.innerHTML =
        `<span class="time">${clock(message.receivedAt)}</span> <b>${escapeHtml(displayName(message.senderId, names))}</b> ` +
        `<span class="kind">${message.kind}</span><br />${escapeHtml(line.text)} ${links}`;
      this.log.prepend(row);
    }
    this.logged = view.log.length;
  }

  /** Timed in real seconds, and held while paused, so a pause leaves time to read them. */
  private renderToasts(run: RunState): void {
    const now = performance.now();
    if (this.lastFrameAt !== null && !run.paused) this.toasts.advance((now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const rows = this.toasts.visible.map(({ id, level, sender, text, point }) => {
      const at = point === null ? '' : ` data-x="${point.x}" data-y="${point.y}"`;
      return `<button class="toast ${level}" data-action="toast" data-id="${id}"${at}><b>${escapeHtml(sender)}</b> ${escapeHtml(text)}</button>`;
    });
    morphHtml(element('map-toasts'), rows.join(''));
  }

  /** Exposed for end-to-end tests and debugging: where the map is looking. */
  get mapCenter(): Vec2 {
    return this.map.viewCenter;
  }

  focusOn(point: Vec2): void {
    this.map.centerOn(point);
  }

  screenPosition(point: Vec2): Vec2 {
    return this.map.toScreen(point);
  }
}
