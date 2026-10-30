import { qualifiesForSupport, type AircraftId, type AircraftOrder, type AircraftTelemetryEntry } from '../domain/public/air';
import type { PlayerAction, ReportRequest } from '../domain/public/commands';
import type { Vec2 } from '../domain/public/geometry';
import type { TerrainGrid } from '../domain/public/terrain';
import type { ContactMarker, FriendlyMarkerView, PlayerView } from '../knowledge/player-view';
import { clock, displayName, forwardPreview, gridRef, radioLine, strengthText, type Names } from './format';
import { MapView, type Selection } from './map-view';
import { morphHtml } from './morph';

type AreaOrderKind = 'MoveTo' | 'Orbit' | 'ReconArea' | 'SupportArea';

export type UiConfig = Readonly<{
  terrain: TerrainGrid;
  names: Names;
  recipients: readonly string[];
  objective: string;
  ackDistanceMeters: number;
  sensorRadius: (aircraft: AircraftTelemetryEntry) => number;
  speeds: readonly number[];
  onAction: (action: PlayerAction) => void;
  onSpeed: (speed: number) => void;
  onTogglePause: () => void;
  onExportLog: () => void;
}>;

export type RunState = Readonly<{ paused: boolean; speed: number; result: string | null }>;

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

export class App {
  private readonly map: MapView;
  private readonly tooltip = element('tooltip');
  private readonly log = element('radio-log');
  private selection: Selection = null;
  private pendingOrder: Readonly<{ aircraftId: AircraftId; kind: AreaOrderKind }> | null = null;
  private recipients = new Set<string>();
  private view: PlayerView | null = null;
  private logged = 0;
  private dragFrom: Vec2 | null = null;
  private dragged = false;

  constructor(private readonly config: UiConfig) {
    const canvas = element<HTMLCanvasElement>('map');
    this.map = new MapView(canvas, config.terrain, config.sensorRadius);
    this.fitCanvas();
    window.addEventListener('resize', () => this.fitCanvas());
    this.bindMap(canvas);
    for (const panel of ['controls', 'aircraft', 'selection', 'requests', 'radio-log']) {
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
    });
    canvas.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
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
    this.selection = selection;
    this.recipients = new Set();
    this.pendingOrder = null;
  }

  private onPanelChange(event: Event): void {
    const input = event.target as HTMLElement;
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

  private updateTooltip(pixel: Vec2): void {
    const view = this.view;
    const hit = view === null ? null : (this.map.hitsAt(pixel, view)[0] ?? null);
    const text = view === null || hit === null ? null : this.tooltipText(hit, view);
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
      const marker = view.contacts.find((m) => m.key === hit.key);
      if (marker === undefined) return null;
      const { contact } = marker;
      return [
        `${contact.identification} ${contact.activity}`,
        `Source: ${displayName(contact.provenance.sourceId, names)} (${marker.viaAircraft ? 'aircraft-observed' : 'reported'})`,
        `Observed ${clock(contact.position.observedAt)}, ${marker.ageSeconds}s ago`,
        `${strengthText(contact.strength)}, ${contact.confidence} confidence`,
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
    this.map.render(view, this.selection);
    this.renderControls(view, run);
    this.renderAircraft(view);
    this.renderRequests(view);
    this.renderSelection(view);
    this.renderLog(view);
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
      const mission = a.casPhase ?? (a.order === null ? 'no mission' : a.order.kind);
      return (
        `<button class="aircraft-row${selected ? ' active' : ''}" data-action="select-aircraft" data-id="${a.aircraftId}">` +
        `${a.aircraftId} <b>${a.status}</b> ${mission} · fuel ${Math.round(a.fuelFraction * 100)}% · ord ${a.ammunition}` +
        `${a.etaSeconds === null ? '' : ` · ETA ${clock(Math.ceil(a.etaSeconds))}`}</button>`
      );
    });
    morphHtml(element('aircraft'), `<h2>Aircraft</h2>${rows.join('')}`);
  }

  private renderRequests(view: PlayerView): void {
    const pending = view.supportRequests.filter((r) => !r.acknowledged);
    const rows = pending.map(
      (r) =>
        `<button data-action="select-friendly" data-id="${escapeHtml(r.unitId)}">${escapeHtml(displayName(r.unitId, this.config.names))}</button>`,
    );
    morphHtml(element('requests'), `<h2>Support requests</h2>${rows.join('') || '<p>None pending</p>'}`);
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
      const marker = view.contacts.find((m) => m.key === selection.key);
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
    return (
      `<h2>${aircraft.aircraftId}</h2><p>${aircraft.status} · ${aircraft.order?.kind ?? 'no mission'}` +
      `${aircraft.casPhase === null ? '' : ` · ${aircraft.casPhase}`}</p>` +
      `<p>Fuel ${Math.round(aircraft.fuelFraction * 100)}% · ordnance ${aircraft.ammunition}</p>` +
      `<label>Radius (m) <input id="order-radius" type="number" value="${radius}" min="100" step="100" /></label>` +
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
      `<h3>Forward intelligence to</h3>${boxes}<p class="preview">${escapeHtml(preview)}</p>` +
      `<button id="transmit" data-action="forward">Transmit</button>`
    );
  }

  private renderLog(view: PlayerView): void {
    const { names, terrain } = this.config;
    for (const message of view.log.slice(this.logged)) {
      const line = radioLine(message, terrain.cellSize);
      const row = document.createElement('div');
      row.className = `log-row ${message.kind.toLowerCase()}`;
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
