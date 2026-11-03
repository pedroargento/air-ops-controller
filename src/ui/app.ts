import { qualifiesForSupport, type AircraftId, type AircraftOrder, type AircraftTelemetryEntry, type RiskLimit, type WeaponsControl } from '../domain/public/air';
import type { PlayerAction, ReportRequest } from '../domain/public/commands';
import type { Debrief, TruthFrame } from '../domain/public/debrief';
import { isAntiAir, type WeaponType } from '../domain/public/equipment';
import { distance, type Vec2 } from '../domain/public/geometry';
import { elevationAt, type TerrainGrid } from '../domain/public/terrain';
import { weatherAt } from '../domain/public/weather';
import type { ContactMarker, FriendlyMarkerView, PlayerView } from '../knowledge/player-view';
import {
  aircraftMission,
  aircraftSummary,
  clock,
  clockSeconds,
  duration,
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
  weaponTag,
} from './format';
import { AltitudeProfile } from './altitude-profile';
import { PathProfile } from './path-profile';
import { summarizeBattle, type BattleSummary, type SummaryConfig } from './battle-summary';
import { MapView, type Selection, type WeatherLayer } from './map-view';
import { ToastQueue } from './toasts';
import { admiraltyRating, BREVITY, contactCondition } from './map-conventions';
import { boardSegments, type BoardPhase } from './status-board';
import { isMoonUp, lightState, nextFirstLight } from '../domain/public/light';
import { sortedTracks, type TrackSort } from './track-list';
import { neighbourEvent, Snapshots, SNAPSHOT_SECONDS, timelineEvents } from './timeline';
import { etaTo, requestStatus, showRequest, supportOptions } from './requests';
import { legendHtml, paintLegend } from './legend';
import { POI_KINDS, type PoiKind } from '../domain/public/poi';
import { morphHtml } from './morph';
import { stormMovement, type ForecastError } from './weather-chart';

type AreaOrderKind = 'Watch' | 'Cover' | 'Suppress' | 'Strike';

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
  /** How long a message to a unit takes, so the outgoing log can say when it arrives. */
  transmitSeconds: number;
  onSpeed: (speed: number) => void;
  onTogglePause: () => void;
  onExportLog: () => void;
  /** The downed aircrew in a rescue mission, or null. */
  survivorId: string | null;
  /** Runs the battle fast until first light, stopping for anything that needs the controller. */
  onWaitForLight: () => void;
  /** Where everyone really was, through the run: null until the run is over. */
  truthHistory: () => readonly TruthFrame[] | null;
}>;

export type RunState = Readonly<{ paused: boolean; speed: number; result: string | null; debrief: Debrief | null }>;

const ORDER_LABELS: Readonly<Record<AreaOrderKind, string>> = {
  Watch: 'Watch',
  Cover: 'Cover',
  Suppress: 'Suppress',
  Strike: 'Strike',
};

/** What each task does, for the button's tooltip and the picking banner. */
const ORDER_HELP: Readonly<Record<AreaOrderKind | 'Illuminate', string>> = {
  Watch: 'Watch an area: recon searches it; a strike aircraft engages what it finds there, as weapons control allows.',
  Cover: 'Cover a friendly platoon: watch the ground ahead of it and follow it.',
  Suppress: 'Gun runs on an area until a set time, with no target needed.',
  Strike: 'One bomb pass on a place, then watch it.',
  Illuminate: 'Keep a flare burning over an area until a set time, so it can be seen at night. It lights friends there too.',
};

const WEAPONS_HELP: Readonly<Record<WeaponsControl, string>> = {
  hold: 'Picks no targets of its own. Suppress and Strike still fire.',
  heavy: 'May use bombs on targets it finds.',
  guns: 'May use guns on targets it finds, spreading bursts over its time on station.',
  both: 'May use bombs and guns on targets it finds.',
};

const RISK_HELP: Readonly<Record<RiskLimit, string>> = {
  cautious: 'Stays above every weapon it knows of and breaks off at any ground fire.',
  normal: 'Breaks off when hit or fired on by air defense.',
  pressOn: 'Never breaks off, and attacks where it was shot at.',
};

const STRIKE_RADIUS = 300;

/** From the map menu there's no radius field, so a fire mission covers about a platoon's ground. */
const MENU_FIRE_RADIUS = 150;
/** An aircraft sent to answer a request watches this far around the unit. */
const SUPPORT_RADIUS = 500;
const DEFAULT_SUPPRESS_MINUTES = 5;

const WEAPONS_LABELS: Readonly<Record<WeaponsControl, string>> = { hold: 'Hold', heavy: 'Bombs', guns: 'Guns', both: 'Both' };

/** Fire missions are for strike aircraft that can take an order now. */
const canFire = (aircraft: AircraftTelemetryEntry): boolean =>
  aircraft.aircraftType === 'cas' && !aircraft.damaged && aircraft.status !== 'turnaround' && aircraft.status !== 'returning';

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
  return order === null || order.kind === 'ReturnToBase' ? null : order.center;
}

const BOARD_HORIZON_SECONDS = 3600;
const BOARD_LABELS: Readonly<Record<BoardPhase, string>> = {
  transit: 'en route',
  station: 'on station',
  return: 'returning',
  turnaround: 'rearming',
  ready: 'ready',
};

/** The next hour for each aircraft, as an operations room's status board shows it. */
function statusBoardHtml(view: PlayerView): string {
  const rows = view.aircraft.map((aircraft) => {
    const bars = boardSegments(aircraft, BOARD_HORIZON_SECONDS)
      .map((segment) => {
        const left = (segment.fromSeconds / BOARD_HORIZON_SECONDS) * 100;
        const width = ((segment.toSeconds - segment.fromSeconds) / BOARD_HORIZON_SECONDS) * 100;
        const until = segment.toSeconds >= BOARD_HORIZON_SECONDS ? '' : ` until ${clock(view.tick + segment.toSeconds)}`;
        return `<span class="board-${segment.phase}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%" title="${BOARD_LABELS[segment.phase]}${until}"></span>`;
      })
      .join('');
    return `<div class="board-row"><b>${escapeHtml(aircraft.aircraftId)}</b><div class="board-track">${bars}</div></div>`;
  });
  return (
    `<div class="board"><div class="board-row"><span></span><div class="board-scale"><span>now</span><span>+15</span><span>+30</span><span>+45</span><span>+60 min</span></div></div>${rows.join('')}` +
    '<p class="hint-quiet">Blue en route · green on station · grey returning · amber rearming · clear ready. Hover a bar for times.</p></div>'
  );
}

/** Claimed losses and what they suggest, as the condition bar shows them. */
function conditionLine(marker: ContactMarker): string {
  const condition = contactCondition(marker.estimatedLosses, marker.contact.strength);
  if (condition === null) return '';
  const words = condition.probablyDestroyed ? 'probably destroyed' : CONDITION_WORDS[condition.condition];
  return `<p>Condition: ${words}, about ${marker.estimatedLosses} casualties claimed (${Math.round(condition.lostShare * 100)}% of its estimated strength)</p>`;
}

const CONDITION_WORDS = { capable: 'still capable', neutralized: 'neutralized', combatIneffective: 'combat-ineffective' } as const;

/** The light now, from the forecast's ephemeris: day or night, the moon, and when light comes or goes. */
function lightHtml(view: PlayerView): string {
  const sky = view.forecast?.sky;
  if (sky === undefined) return '';
  const state = lightState(sky, view.tick);
  const at = (secondsOfDay: number): string => clock(((secondsOfDay - sky.startSecondsOfDay) % 86400 + 86400) % 86400);
  if (state === 'day') return `<span id="light" class="day" title="Light">Day · sunset ${at(sky.sunsetSeconds)}</span>`;
  const moon = isMoonUp(sky, view.tick)
    ? `moon ${Math.round(sky.moonIllumination * 100)}%, sets ${at(sky.moonsetSeconds)}`
    : 'no moon';
  return `<span id="light" class="${state}" title="Light: crews see little in the dark except muzzle flashes and what flares light up.">${state === 'night' ? 'Night' : 'Twilight'} · ${moon} · first light ${clock(nextFirstLight(sky, view.tick))}</span>`;
}

/** An order as the controller would read it back. */
function describeOrder(order: AircraftOrder, names: Names, cellSize: number): string {
  switch (order.kind) {
    case 'Watch':
      return `watch ${gridRef(order.center, cellSize)}, ${order.radius} m around`;
    case 'Cover':
      return `cover ${displayName(order.unitId, names)}`;
    case 'Suppress':
      return `suppress ${gridRef(order.center, cellSize)} until ${clock(order.untilTick)}`;
    case 'Strike':
      return `one bomb pass on ${gridRef(order.center, cellSize)}`;
    case 'Illuminate':
      return `light ${gridRef(order.center, cellSize)} with flares until ${clock(order.untilTick)}`;
    case 'Pickup':
      return `land at ${gridRef(order.center, cellSize)} for a pickup`;
    case 'ReturnToBase':
      return 'return to base';
  }
}

function findContact(view: PlayerView, key: string): ContactMarker | undefined {
  return view.contacts.flatMap((marker) => [marker, ...marker.members]).find((marker) => marker.key === key);
}

/** Each source's real record, so the player learns whose reports to trust next time. */
function sourcesTable(debrief: Debrief): string {
  if (debrief.sources.length === 0) return '';
  const rows = [...debrief.sources]
    .sort((a, b) => a.reliability.localeCompare(b.reliability) || b.reports - a.reports)
    .map(
      (source) =>
        `<tr><td>${escapeHtml(source.sourceId)}</td><td>${source.reliability}</td><td>${source.reports}</td>` +
        `<td>${source.meanErrorMeters} m</td><td>${source.misidentified}</td><td>${source.claimed}</td></tr>`,
    )
    .join('');
  return (
    `<h3>How good the reports were</h3><table class="scorecard"><tr><th>Source</th><th>Reliability</th><th>Reports</th>` +
    `<th>Average error</th><th>Wrong side</th><th>Claimed</th></tr>${rows}</table>` +
    '<p class="hint-quiet">Reliability A is completely reliable, E unreliable: any friendly reported as hostile gives an E.</p>'
  );
}

/** The one place the truth appears, once the run is over: what really happened against the estimates. */
function debriefHtml(debrief: Debrief, summary: BattleSummary): string {
  const enemyLost = debrief.enemyStart - debrief.enemyLeft;
  return (
    `<h3>Debrief: what really happened</h3>` +
    `<p>Enemy: ${debrief.enemyStart} at start, ${debrief.enemyLeft} left. ${enemyLost} lost, against your estimate of ${rangeText(summary.losses)}.</p>` +
    `<p>Formations: ${debrief.enemyFormations}, of which ${debrief.enemyDestroyed} destroyed and ${debrief.enemyBroken} broken.</p>` +
    (debrief.locatedShare === null ? '' : `<p>Your picture had ${Math.round(debrief.locatedShare * 100)}% of the enemy's squads about right.</p>`) +
    (debrief.friendlyFireCasualties === 0 ? '' : `<p>${debrief.friendlyFireCasualties} of your men were hit by your own strikes.</p>`) +
    `<p>Friendly: ${debrief.friendlyStart} at start, ${debrief.friendlyLeft} left, ${debrief.friendlyDestroyed} formations lost.</p>` +
    `<p>Enemy casualties claimed: ${debrief.airClaims} by aircrews, ${debrief.groundClaims} by ground units. Really lost: ${enemyLost}. Claims from different sources can count the same men.</p>` +
    sourcesTable(debrief)
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
  private sideTab: 'radio' | 'summary' | 'tracks' = 'radio';
  private trackSort: TrackSort = 'threat';
  private readonly snapshots = new Snapshots();
  /** Looking back through the timeline: the map shows the battle as known at reviewTick. */
  private reviewing = false;
  private reviewTick = 0;
  private resumeAfterReview = false;
  private showTruth = false;
  private run: RunState | null = null;
  private radioFilter: 'main' | 'all' = 'main';
  private heardContacts: readonly ContactMemory[] = [];
  private readonly toasts = new ToastQueue();
  private lastFrameAt: number | null = null;
  private menuPoint: Vec2 | null = null;
  private readonly layers = new Set<'weather'>();
  /** The map key stays out of the way until asked for. */
  private legendShown = false;
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
    document.addEventListener('keydown', (event) => this.onKey(event));
    element('timeline-slider').addEventListener('input', (event) => {
      this.reviewTick = Number((event.target as HTMLInputElement).value);
    });
    for (const panel of ['controls', 'aircraft', 'selection', 'requests', 'radio-log', 'side-tabs', 'map-layers', 'forecast', 'map-toasts', 'map-menu', 'legend', 'tracks', 'timeline', 'pickup']) {
      element(panel).addEventListener('click', (event) => this.onPanelClick(event));
      element(panel).addEventListener('change', (event) => this.onPanelChange(event));
    }
  }

  /**
   * Shortcuts: Esc cancels, Space pauses, 1–9 pick an aircraft, then W watch, C cover, S
   * suppress, K strike, R return to base. T opens the timeline, ? the key. Ignored while typing.
   */
  private onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const view = this.view;
    const chosen = this.selection;
    const selected = chosen?.kind === 'aircraft' ? view?.aircraft.find((a) => a.aircraftId === chosen.id) : undefined;
    const start = (kind: AreaOrderKind): void => {
      if (selected === undefined) return;
      if ((kind === 'Suppress' || kind === 'Strike') && selected.aircraftType !== 'cas') return;
      this.pendingOrder = { aircraftId: selected.aircraftId as AircraftId, kind };
    };
    switch (event.key) {
      case 'Escape':
        this.pendingOrder = null;
        this.closeMapMenu();
        this.legendShown = false;
        break;
      case ' ':
        this.config.onTogglePause();
        break;
      case 'w':
        start('Watch');
        break;
      case 'c':
        start('Cover');
        break;
      case 's':
        start('Suppress');
        break;
      case 'k':
        start('Strike');
        break;
      case 'r':
        if (selected !== undefined) this.order(selected.aircraftId, { kind: 'ReturnToBase' });
        break;
      case '?':
        this.legendShown = !this.legendShown;
        break;
      case 't':
        this.toggleTimeline();
        break;
      default: {
        const index = Number(event.key);
        const aircraft = Number.isInteger(index) && index >= 1 ? view?.aircraft[index - 1] : undefined;
        if (aircraft === undefined) return;
        this.select({ kind: 'aircraft', id: aircraft.aircraftId });
      }
    }
    event.preventDefault();
  }

  private readonly landed = new Set<string>();

  /**
   * While a helicopter is on the ground for a pickup, the seconds matter: the game drops to
   * normal speed when it lands, and a panel shows boarding, the survivor coming, the fire it's
   * taking and its escorts, with lift off one click away.
   */
  private renderPickup(view: PlayerView): void {
    const panel = element('pickup');
    const down = view.aircraft.filter((aircraft) => aircraft.landed);
    for (const aircraft of down) {
      if (!this.landed.has(aircraft.aircraftId)) this.config.onSpeed(1);
    }
    this.landed.clear();
    for (const aircraft of down) this.landed.add(aircraft.aircraftId);
    panel.hidden = down.length === 0;
    if (down.length === 0) return;
    const rows = down.map((aircraft) => {
      const share = Math.min(1, aircraft.boardingSeconds / aircraft.boardNeedSeconds);
      const coming = aircraft.survivorMeters === null ? 'No survivor coming yet.' : aircraft.survivorMeters <= 25 ? 'Survivor at the door, boarding.' : `Survivor ${Math.round(aircraft.survivorMeters)} m away, running for it.`;
      const fire = view.log.filter((message) => message.kind === 'GROUND_FIRE' && message.senderId === aircraft.aircraftId && view.tick - message.receivedAt <= 15).length;
      const escorts = view.aircraft
        .filter((other) => other.aircraftType === 'cas' && (other.order?.kind === 'Cover' || other.order?.kind === 'Suppress') && other.status === 'onStation')
        .map((other) => `${other.aircraftId} ${other.order?.kind === 'Suppress' ? 'suppressing' : 'covering'}`);
      const center = aircraft.order === null || aircraft.order.kind === 'ReturnToBase' ? aircraft.position : aircraft.order.center;
      return (
        `<div class="pickup-row"><b>${escapeHtml(aircraft.aircraftId)} on the ground</b>` +
        `<div class="pickup-bar"><span style="width:${(share * 100).toFixed(0)}%"></span></div>` +
        `<span>Boarding ${Math.round(aircraft.boardingSeconds)} of ${aircraft.boardNeedSeconds} s. ${escapeHtml(coming)}</span>` +
        `<span class="${fire > 0 ? 'danger' : 'hint-quiet'}">${fire > 0 ? `Taking fire: ${fire} burst${fire === 1 ? '' : 's'} in the last 15 s.` : 'No fire taken.'}</span>` +
        `<span class="hint-quiet">Escorts: ${escorts.length === 0 ? 'none on station' : escapeHtml(escorts.join(', '))}.</span>` +
        `<div class="buttons"><button class="lift" data-action="lift-off" data-id="${escapeHtml(aircraft.aircraftId)}">Lift off now</button>` +
        `<button data-action="center" data-x="${center.x}" data-y="${center.y}">Show</button></div></div>`
      );
    });
    morphHtml(panel, rows.join(''));
  }

  /** Opening the timeline pauses the battle; closing it goes back to live and resumes if it was running. */
  private toggleTimeline(): void {
    const run = this.run;
    if (!this.reviewing) {
      this.reviewing = true;
      this.reviewTick = this.view?.tick ?? 0;
      this.resumeAfterReview = run !== null && !run.paused && run.result === null;
      if (this.resumeAfterReview) this.config.onTogglePause();
    } else {
      this.reviewing = false;
      if (this.resumeAfterReview && this.run?.paused === true) this.config.onTogglePause();
      this.resumeAfterReview = false;
    }
  }

  private reviewAt(tick: number, point: Vec2 | null): void {
    this.reviewTick = Math.max(0, tick);
    element<HTMLInputElement>('timeline-slider').value = String(this.reviewTick);
    if (point !== null) this.map.centerOn(point);
  }

  /** The timeline over the map: the moment shown, a slider with event marks, and what happened near it. */
  private renderTimeline(view: PlayerView, run: RunState): void {
    const panel = element('timeline');
    panel.hidden = !this.reviewing;
    if (!this.reviewing) return;
    const end = Math.max(SNAPSHOT_SECONDS, view.tick);
    const slider = element<HTMLInputElement>('timeline-slider');
    slider.max = String(end);
    if (document.activeElement !== slider) slider.value = String(this.reviewTick);
    const events = timelineEvents(view.log, this.config.terrain.cellSize);
    const truth = run.result === null
      ? '<span class="hint-quiet">Where units really were shows here after the run.</span>'
      : `<label><input type="checkbox" data-action="review-truth"${this.showTruth ? ' checked' : ''} /> Show where everyone really was</label>`;
    morphHtml(
      element('timeline-head'),
      `<span class="review-time">${clock(this.reviewTick)}</span><span>The map as you knew it then${run.result === null ? '; the battle is paused' : ''}.</span>` +
        `<button data-action="review-step" data-kind="back">◀ Previous event</button><button data-action="review-step" data-kind="next">Next event ▶</button>` +
        `${truth}<button class="primary" data-action="timeline">Back to live</button>`,
    );
    morphHtml(
      element('timeline-marks'),
      events.map((event) => `<span class="${event.level}" style="left:${((event.tick / end) * 100).toFixed(2)}%" title="${clock(event.tick)} ${escapeHtml(event.text)}"></span>`).join(''),
    );
    const near = events.filter((event) => Math.abs(event.tick - this.reviewTick) <= 180);
    morphHtml(
      element('timeline-events'),
      near.length === 0
        ? '<p class="hint-quiet">Nothing on the radio within three minutes of this moment.</p>'
        : near
            .map((event) => {
              const at = event.point === null ? '' : ` data-x="${event.point.x}" data-y="${event.point.y}"`;
              return `<button class="${event.level}" data-action="review-event" data-id="${event.tick}"${at}>${clock(event.tick)} <b>${escapeHtml(displayName(event.senderId, this.config.names))}</b> ${escapeHtml(event.text)}</button>`;
            })
            .join(''),
    );
  }

  private fitCanvas(): void {
    const holder = element('map-holder');
    this.map.resize(holder.clientWidth, holder.clientHeight);
  }

  private bindMap(canvas: HTMLCanvasElement): void {
    const pixel = (event: MouseEvent): Vec2 => ({ x: event.offsetX, y: event.offsetY });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
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
      if (event.button === 0 && !this.dragged) this.onMapClick(pixel(event));
    });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openMapMenu(pixel(event));
    });
    canvas.addEventListener('mousedown', () => this.closeMapMenu());
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.map.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
  }

  /** Things the player can report at a place. New kinds of mark appear here by themselves. */
  /**
   * Right-click: what can be done right here. On a friendly unit, support and reports for it; on
   * a contact, fire on it or forward it; anywhere, tasks for aircraft at that place and marks.
   */
  private openMapMenu(pixel: Vec2): void {
    const { recipients, names, terrain } = this.config;
    const view = this.view;
    let point = this.map.toWorld(pixel);
    const hit = view === null ? undefined : this.map.hitsAt(pixel, view).find((entry) => entry.kind !== 'aircraft');
    const sections: string[] = [];
    const aircraft = view?.aircraft ?? [];
    const available = (entry: AircraftTelemetryEntry): boolean => !entry.damaged && entry.status !== 'turnaround' && entry.status !== 'returning';
    if (hit?.kind === 'friendly' && view !== null) {
      const friendly = view.friendlies.find((entry) => entry.unitId === hit.id);
      const name = escapeHtml(displayName(hit.id, names));
      const id = escapeHtml(hit.id);
      const request = view.supportRequests.find((entry) => entry.unitId === hit.id && (entry.answer === null || entry.answer.kind === 'cancelled'));
      const support = aircraft.filter((entry) => canFire(entry)).map((entry) =>
        request === undefined
          ? `<button data-action="cover" data-id="${id}" data-kind="${escapeHtml(entry.aircraftId)}">Cover with ${escapeHtml(entry.aircraftId)}</button>`
          : `<button class="primary" data-action="send-support" data-id="${id}" data-kind="${escapeHtml(entry.aircraftId)}">Send ${escapeHtml(entry.aircraftId)} to support</button>`,
      );
      sections.push(
        `<h3>${name}</h3>${support.join('')}` +
          `<button data-action="request" data-id="${id}" data-kind="position">Ask for position</button>` +
          `<button data-action="request" data-id="${id}" data-kind="sitrep">Ask for a SITREP</button>` +
          `<button data-action="request" data-id="${id}" data-kind="contact">Ask for a contact update</button>` +
          `<button data-action="select-friendly" data-id="${id}">Show details</button>`,
      );
      if (friendly !== undefined) point = friendly.position.center;
    } else if (hit?.kind === 'contact' && view !== null) {
      const marker = view.contacts.flatMap((entry) => [entry, ...entry.members]).find((entry) => entry.key === hit.key);
      if (marker !== undefined) {
        point = marker.contact.position.center;
        const key = escapeHtml(marker.key);
        sections.push(
          `<h3>${marker.trackNumber === null ? 'Report' : `Track TN ${marker.trackNumber}`}</h3>` +
            `<button data-action="select-contact" data-id="${key}">Details and forward to units</button>` +
            (marker.members.length > 0 ? `<button data-action="split" data-id="${key}">Split into its ${marker.members.length + 1} reports</button>` : ''),
        );
      }
    }
    this.menuPoint = point;
    const near = view?.pois.filter((poi) => distance(poi.center, point) <= poi.radiusMeters) ?? [];
    const cancels = near.map(
      (poi) => `<button data-action="cancel-poi" data-id="${poi.id}">Cancel ${escapeHtml(POI_KINDS[poi.kind].label.toLowerCase())}</button>`,
    );
    const tasks = aircraft.filter(available).map((entry) => {
      const id = escapeHtml(entry.aircraftId);
      const fire = canFire(entry)
        ? `<button data-action="menu-fire" data-id="${id}" data-kind="Suppress" title="${escapeHtml(ORDER_HELP.Suppress)}">Suppress</button>` +
          `<button data-action="menu-fire" data-id="${id}" data-kind="Strike" title="${escapeHtml(ORDER_HELP.Strike)}">Strike</button>`
        : '';
      const flares = entry.flares > 0 ? `<button data-action="menu-illuminate" data-id="${id}" title="${escapeHtml(ORDER_HELP.Illuminate)}">Illuminate</button>` : '';
      const pickup = entry.seats > 0 ? `<button class="primary" data-action="menu-pickup" data-id="${id}" title="Land here and wait while the survivor boards. Lift off any time.">Pick up here</button>` : '';
      return `<div class="menu-fire"><b>${id}</b><button data-action="menu-watch" data-id="${id}" title="${escapeHtml(ORDER_HELP.Watch)}">Watch</button>${fire}${flares}${pickup}</div>`;
    });
    const minutes = aircraft.some((entry) => canFire(entry) || entry.flares > 0) ? `<label>Suppress or illuminate for <input id="menu-minutes" type="number" value="${DEFAULT_SUPPRESS_MINUTES}" min="1" step="1" /> min</label>` : '';
    const boxes = recipients.map(
      (id) => `<label><input type="checkbox" data-poi-recipient="${escapeHtml(id)}" checked /> ${escapeHtml(displayName(id, names))}</label>`,
    );
    const kinds = Object.entries(POI_KINDS).map(
      ([kind, { label }]) => `<button data-action="report-poi" data-id="${kind}">Report ${escapeHtml(label.toLowerCase())}</button>`,
    );
    sections.push(`<h3>Aircraft to grid ${gridRef(point, terrain.cellSize)}</h3>${tasks.join('') || '<p class="hint-quiet">No aircraft can take a task now.</p>'}${minutes}`);
    const survivor = this.config.survivorId;
    if (survivor !== null) {
      sections.push(
        `<h3>Survivor</h3><button data-action="menu-pickup-point" data-id="${escapeHtml(survivor)}" title="The survivor makes for it when it judges it safe.">Pickup point for ${escapeHtml(displayName(survivor, names))} here</button>`,
      );
    }
    sections.push(`<h3>Mark this place for</h3><div class="menu-recipients">${boxes.join('')}</div>${kinds.join('')}${cancels.join('')}`);
    const menu = element('map-menu');
    menu.innerHTML = `${sections.join('<hr />')}<button data-action="close-menu">Close</button>`;
    menu.hidden = false;
    // Measured once shown: near an edge the menu opens back towards the map.
    const holder = element('map-holder');
    menu.style.left = `${Math.max(0, Math.min(pixel.x, holder.clientWidth - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(pixel.y, holder.clientHeight - menu.offsetHeight))}px`;
  }

  private closeMapMenu(): void {
    element('map-menu').hidden = true;
    this.menuPoint = null;
  }

  private reportPoi(kind: PoiKind): void {
    const center = this.menuPoint;
    if (center === null) return;
    const boxes = element('map-menu').querySelectorAll<HTMLInputElement>('input[data-poi-recipient]');
    const recipients = [...boxes].flatMap((box) => (box.checked ? [box.dataset['poiRecipient'] as string] : []));
    if (recipients.length === 0) return;
    const names = recipients.map((id) => displayName(id, this.config.names)).join(', ');
    this.issue(
      { kind: 'reportPoi', poiKind: kind, center, radiusMeters: POI_KINDS[kind].radiusMeters, recipients },
      `${POI_KINDS[kind].label} at ${gridRef(center, this.config.terrain.cellSize)}, to ${names}.`,
      true,
    );
    this.closeMapMenu();
  }

  /** Suppress or Strike on the place right-clicked, by the aircraft chosen in the menu. */
  private fireFromMenu(aircraftId: string, kind: 'Suppress' | 'Strike'): void {
    const center = this.menuPoint;
    if (center === null) return;
    const minutes = Number((document.getElementById('menu-minutes') as HTMLInputElement | null)?.value ?? DEFAULT_SUPPRESS_MINUTES);
    this.order(aircraftId, this.fireOrder(kind, center, MENU_FIRE_RADIUS, minutes, aircraftId));
    this.closeMapMenu();
  }

  /** When a timed task over a place should end: its minutes count from when the aircraft gets there. */
  private windowEnd(aircraftId: string, center: Vec2, minutes: number): number {
    const tick = this.view?.tick ?? 0;
    const aircraft = this.view?.aircraft.find((entry) => entry.aircraftId === aircraftId);
    const arrival = aircraft === undefined ? 0 : Math.ceil(etaTo(aircraft, center));
    return tick + arrival + Math.max(1, minutes > 0 ? minutes : DEFAULT_SUPPRESS_MINUTES) * 60;
  }

  private fireOrder(kind: 'Suppress' | 'Strike', center: Vec2, radius: number, minutes: number, aircraftId: string): AircraftOrder {
    if (kind === 'Strike') return { kind, center, radius };
    return { kind, center, radius, untilTick: this.windowEnd(aircraftId, center, minutes) };
  }

  private onMapClick(pixel: Vec2): void {
    const pending = this.pendingOrder;
    if (pending !== null) {
      if (pending.kind === 'Cover') {
        // Cover needs a friendly platoon: the click has to land on one.
        const friendly = this.view === null ? undefined : this.map.hitsAt(pixel, this.view).find((hit) => hit.kind === 'friendly');
        if (friendly?.kind !== 'friendly') return;
        this.coverWith(pending.aircraftId, friendly.id);
      } else {
        this.order(pending.aircraftId, this.buildOrder(pending.kind, this.map.toWorld(pixel), pending.aircraftId));
      }
      this.pendingOrder = null;
      return;
    }
    if (this.view === null) return;
    const hits = this.map.hitsAt(pixel, this.view);
    // Clicking again on overlapping markers moves on to the next one.
    const current = hits.findIndex((hit) => JSON.stringify(hit) === JSON.stringify(this.selection));
    this.select(hits[(current + 1) % hits.length] ?? null);
  }

  private buildOrder(kind: Exclude<AreaOrderKind, 'Cover'>, point: Vec2, aircraftId: string): AircraftOrder {
    const input = document.getElementById('order-radius') as HTMLInputElement | null;
    const typed = Number(input?.value ?? 0);
    const radius = kind === 'Strike' ? STRIKE_RADIUS : typed > 0 ? typed : 500;
    if (kind === 'Watch') return { kind, center: point, radius };
    const minutes = Number((document.getElementById('order-minutes') as HTMLInputElement | null)?.value ?? DEFAULT_SUPPRESS_MINUTES);
    return this.fireOrder(kind, point, radius, minutes, aircraftId);
  }

  private select(selection: Selection): void {
    if (selection?.kind === 'aircraft') this.lastAircraftId = selection.id;
    this.selection = selection;
    this.recipients = new Set();
    this.pendingOrder = null;
  }

  private toggleLayer(layer: 'weather'): void {
    if (!this.layers.delete(layer)) this.layers.add(layer);
    this.setForecastLead(0);
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
    const button = (id: 'weather', label: string): string =>
      `<button data-action="layer" data-id="${id}"${this.layers.has(id) ? ' class="active"' : ''}>${label}</button>`;
    const key = `<button data-action="legend"${this.legendShown ? ' class="active"' : ''}>Key</button>`;
    morphHtml(element('map-layers'), button('weather', 'Weather') + key);
    const legend = element('legend');
    if (this.legendShown && legend.childElementCount === 0) {
      legend.innerHTML = legendHtml();
      paintLegend(legend);
    }
    legend.hidden = !this.legendShown;
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
      this.issue({ kind: 'setAltitude', aircraftId, meters: Number(input.value) }, `${aircraftId}: altitude ${Number(input.value)} m, set by hand.`);
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
        if (id === 'weather') this.toggleLayer('weather');
        return;
      case 'legend':
        this.legendShown = !this.legendShown;
        return;
      case 'forecast-now':
        this.setForecastLead(0);
        return;
      case 'forecast-eta':
        this.setForecastLead(this.etaOfSelected());
        return;
      case 'tab':
        this.sideTab = id === 'summary' || id === 'tracks' ? id : 'radio';
        return;
      case 'track-sort':
        if (id === 'threat' || id === 'age' || id === 'condition') this.trackSort = id;
        return;
      case 'radio-filter':
        this.radioFilter = id === 'all' ? 'all' : 'main';
        return;
      case 'split':
        if (id !== undefined) this.split.add(id);
        this.map.showSplit(this.split);
        this.closeMapMenu();
        return;
      case 'speed':
        this.config.onSpeed(Number(id));
        return;
      case 'timeline':
        this.toggleTimeline();
        return;
      case 'wait-light':
        this.config.onWaitForLight();
        return;
      case 'menu-pickup':
        if (this.menuPoint !== null && id !== undefined) this.order(id, { kind: 'Pickup', center: this.menuPoint, radius: 50 });
        this.closeMapMenu();
        return;
      case 'menu-pickup-point':
        if (this.menuPoint !== null && id !== undefined) {
          this.issue({ kind: 'sendPickupPoint', unitId: id, point: this.menuPoint }, `To ${displayName(id, this.config.names)}: pickup point at ${gridRef(this.menuPoint, this.config.terrain.cellSize)}.`, true);
        }
        this.closeMapMenu();
        return;
      case 'lift-off': {
        const helicopter = this.view?.aircraft.find((aircraft) => aircraft.aircraftId === id);
        if (helicopter !== undefined && helicopter.order !== null && helicopter.order.kind !== 'ReturnToBase') {
          this.order(helicopter.aircraftId, { kind: 'Watch', center: helicopter.order.center, radius: 300 });
        }
        return;
      }
      case 'review-step': {
        const view = this.view;
        if (view === null) return;
        const next = neighbourEvent(timelineEvents(view.log, this.config.terrain.cellSize), this.reviewTick, kind === 'back' ? -1 : 1);
        if (next !== null) this.reviewAt(next.tick, next.point);
        return;
      }
      case 'review-event':
        this.reviewAt(Number(id), x === undefined || y === undefined ? null : { x: Number(x), y: Number(y) });
        return;
      case 'review-truth':
        this.showTruth = !this.showTruth;
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
      case 'weapons':
        if (this.selection?.kind === 'aircraft' && (id === 'hold' || id === 'heavy' || id === 'guns' || id === 'both')) {
          this.issue({ kind: 'setWeapons', aircraftId: this.selection.id as AircraftId, weapons: id }, `${this.selection.id}: weapons ${WEAPONS_LABELS[id].toLowerCase()}.`);
        }
        return;
      case 'menu-fire':
        if (id !== undefined && (kind === 'Suppress' || kind === 'Strike')) this.fireFromMenu(id, kind);
        return;
      case 'menu-watch': {
        const center = this.menuPoint;
        const entry = this.view?.aircraft.find((a) => a.aircraftId === id);
        if (center !== null && entry !== undefined) this.order(entry.aircraftId, { kind: 'Watch', center, radius: entry.aircraftType === 'recon' ? 1000 : SUPPORT_RADIUS });
        this.closeMapMenu();
        return;
      }
      case 'menu-illuminate': {
        const center = this.menuPoint;
        const minutes = Number((document.getElementById('menu-minutes') as HTMLInputElement | null)?.value ?? DEFAULT_SUPPRESS_MINUTES);
        if (center !== null && id !== undefined) this.order(id, { kind: 'Illuminate', center, radius: SUPPORT_RADIUS, untilTick: this.windowEnd(id, center, minutes) });
        this.closeMapMenu();
        return;
      }
      case 'select-track':
        if (id !== undefined) this.select({ kind: 'contact', key: id });
        if (x !== undefined && y !== undefined) this.map.centerOn({ x: Number(x), y: Number(y) });
        return;
      case 'select-contact':
        if (id !== undefined) this.select({ kind: 'contact', key: id });
        this.closeMapMenu();
        return;
      case 'cover':
        if (id !== undefined && kind !== undefined) this.coverWith(kind, id);
        this.closeMapMenu();
        return;
      case 'cancel-order':
        this.pendingOrder = null;
        return;
      case 'risk':
        if (this.selection?.kind === 'aircraft') {
          this.issue({ kind: 'setRisk', aircraftId: this.selection.id as AircraftId, risk: id as RiskLimit }, `${this.selection.id}: risk ${id === 'pressOn' ? 'press on' : id}.`);
        }
        return;
      case 'crew-altitude':
        if (this.selection?.kind === 'aircraft') {
          this.issue({ kind: 'releaseAltitude', aircraftId: this.selection.id as AircraftId }, `${this.selection.id}: crew chooses its own altitude again.`);
        }
        return;
      case 'danger-close':
        if (id !== undefined) {
          const name = displayName(id, this.config.names);
          const approved = kind === 'approve';
          this.issue(
            { kind: 'answerDangerClose', unitId: id, approved },
            approved ? `Danger close cleared for ${name} for 10 minutes. Crews may now fire near them.` : `Danger close not cleared for ${name}. Crews keep their distance.`,
          );
        }
        return;
      case 'report-poi':
        this.reportPoi(id as PoiKind);
        return;
      case 'cancel-poi':
        if (id !== undefined) this.issue({ kind: 'cancelPoi', poiId: id }, 'Mark cancelled; the units who had it are told.', true);
        this.closeMapMenu();
        return;
      case 'close-menu':
        this.closeMapMenu();
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
          this.order(this.selection.id, { kind: 'ReturnToBase' });
        }
        return;
      case 'request':
        this.issue(
          { kind: 'requestReport', unitId: id ?? '', report: kind as ReportRequest },
          `To ${displayName(id ?? '', this.config.names)}: send ${kind === 'sitrep' ? 'a SITREP' : kind === 'position' ? 'your position' : 'a contact update'}.`,
          true,
        );
        return;
      case 'ack':
        this.issue(
          { kind: 'acknowledge', unitId: id ?? '', casAircraftId: kind === undefined || kind === '' ? null : (kind as AircraftId) },
          `To ${displayName(id ?? '', this.config.names)}: ${kind === undefined || kind === '' ? 'request acknowledged.' : `${kind} inbound.`}`,
          true,
        );
        return;
      case 'send-support':
        if (id !== undefined && kind !== undefined) this.sendSupport(id, kind);
        return;
      case 'no-air':
        if (id !== undefined) {
          this.issue({ kind: 'acknowledge', unitId: id, casAircraftId: null }, `To ${displayName(id, this.config.names)}: no air available.`, true);
        }
        return;
      case 'forward':
        if (this.selection?.kind === 'contact' && this.recipients.size > 0) {
          const to = [...this.recipients].sort();
          this.issue(
            { kind: 'forwardContact', contactKey: this.selection.key, recipients: to },
            `Intelligence forwarded to ${to.map((unit) => displayName(unit, this.config.names)).join(', ')}.`,
            true,
          );
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
        `${marker.trackNumber === null ? 'Report' : `Track TN ${marker.trackNumber}`}: ${contact.identification} ${contact.activity}`,
        `Source: ${displayName(contact.provenance.sourceId, names)} (${marker.viaAircraft ? 'aircraft-observed' : 'reported'})`,
        `Observed ${clock(contact.position.observedAt)}, ${marker.ageSeconds}s ago`,
        `${strengthText(contact.strength)}, ${contact.confidence} confidence, rated ${admiraltyRating(marker)}`,
        weaponsText(contact.observedWeapons),
        ...(marker.members.length > 0 ? [`${marker.members.length + 1} reports on this track`] : []),
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
    this.run = run;
    this.snapshots.record(view);
    const shown = this.reviewing ? (this.snapshots.at(this.reviewTick) ?? view) : view;
    this.map.render(shown, this.selection, this.threatAltitude(view), {
      weather: this.reviewing ? null : this.weatherLayer(view),
    });
    if (this.reviewing && this.showTruth) {
      const frames = this.config.truthHistory();
      const frame = frames === null ? undefined : [...frames].reverse().find((entry) => entry.tick <= this.reviewTick) ?? frames[0];
      if (frame !== undefined) this.map.drawTruth(frame);
    }
    this.renderTimeline(view, run);
    this.renderPickup(view);
    this.renderControls(view, run);
    this.renderAircraft(view);
    this.renderRequests(view);
    this.renderSelection(view);
    this.renderLog(view);
    this.renderToasts(run);
    this.renderSideTab(view, run);
    this.renderLayers(view);
    element('map-holder').classList.toggle('picking', this.pendingOrder !== null);
    this.renderBanner();
  }

  /** While a task waits for a place, say so over the map: what, for whom, and how to cancel. */
  private renderBanner(): void {
    const banner = element('map-banner');
    const pending = this.pendingOrder;
    banner.hidden = pending === null;
    if (pending === null) return;
    const where = pending.kind === 'Cover' ? 'Click a friendly unit' : 'Click the map';
    morphHtml(banner, `${where} to set <b>${ORDER_LABELS[pending.kind].toUpperCase()}</b> for <b>${escapeHtml(pending.aircraftId)}</b> · Esc to cancel`);
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
        `<span id="clock" title="Local time">${clockSeconds(view.tick)}</span>` +
        `<span id="mission-time">T+${duration(view.tick)} · <b>${duration(Math.max(0, this.config.durationSeconds - view.tick))} left</b></span>` +
        lightHtml(view) +
        (view.forecast !== null && lightState(view.forecast.sky, view.tick) !== 'day' && run.result === null
          ? '<button data-action="wait-light" title="Run fast to first light, stopping for anything that needs you. Pause stops it.">Wait for first light</button>'
          : '') +
        `<span id="status">${escapeHtml(status)}</span>` +
        `<span id="objective">${escapeHtml(this.config.objective)}</span>` +
        `<button data-action="timeline"${this.reviewing ? ' class="active"' : ''} title="Look back through the battle as you knew it (T).">Timeline</button>` +
        `<button data-action="export">Export log</button>`,
    );
  }

  private renderAircraft(view: PlayerView): void {
    const rows = view.aircraft.map((a) => {
      const selected = this.selection?.kind === 'aircraft' && this.selection.id === a.aircraftId;
      const eta = a.etaSeconds === null ? '' : ` ${duration(a.etaSeconds)}`;
      return (
        `<button class="aircraft-row${selected ? ' active' : ''}" data-action="select-aircraft" data-id="${a.aircraftId}" title="${escapeHtml(aircraftSummary(a))}">` +
        `<b>${a.aircraftId}</b><b>${a.damaged ? 'DAMAGED' : a.status}</b>` +
        `<span class="mission">${aircraftMission(a)}${eta}</span>` +
        `<span>${a.landed ? 'landed' : `${Math.round(a.altitudeMeters)} m`}${a.aboveCloud ? ' ☁' : ''}</span><span>${Math.round(a.fuelFraction * 100)}%</span><span>ord ${a.ammunition}/${a.gunBursts}</span></button>`
      );
    });
    morphHtml(element('aircraft'), rows.join(''));
    const selected = this.selection?.kind === 'aircraft' ? this.selection.id : null;
    this.profile.render(view, selected, this.forecastCeiling(view));
    const aircraft = view.aircraft.find((a) => a.aircraftId === selected) ?? null;
    this.pathProfile.render(aircraft, aircraft === null ? null : aircraftDestination(aircraft));
  }

  /**
   * Each support request as a card: what the unit asked for, one click to answer it with any
   * strike aircraft that can go, why the others can't, and where the answer stands since.
   */
  private renderRequests(view: PlayerView): void {
    const { names, terrain } = this.config;
    const cards = view.supportRequests
      .filter((request) => showRequest(request, view.aircraft, view.tick))
      .map((request) => {
        const unit = escapeHtml(request.unitId);
        const name = escapeHtml(displayName(request.unitId, names));
        const ask =
          request.target === null
            ? `Wants ${request.wants === 'both' ? 'air support' : request.wants === 'guns' ? 'guns' : 'bombs'} at ${gridRef(request.position.center, terrain.cellSize)}.`
            : `${request.targetStrength === null ? 'Enemy' : escapeHtml(strengthText(request.targetStrength))} at ${gridRef(request.target, terrain.cellSize)}` +
              `${request.marked ? ', marked by smoke' : ''}. Friendlies at ${gridRef(request.position.center, terrain.cellSize)}.` +
              `${request.wants === 'both' ? '' : ` Wants ${request.wants === 'guns' ? 'guns' : 'bombs'}.`}`;
        const answering = request.answer === null || request.answer.kind === 'cancelled';
        const options = answering ? supportOptions(request, view.aircraft, clock, view.tick) : [];
        const sends = options
          .filter((option) => option.available)
          .map(
            (option) =>
              `<button class="primary" data-action="send-support" data-id="${unit}" data-kind="${escapeHtml(option.aircraftId)}">` +
              `Send ${escapeHtml(option.aircraftId)} · ETA ${clock(view.tick + Math.ceil(option.etaSeconds ?? 0))}</button>`,
          )
          .join('');
        const cannot = options
          .filter((option) => !option.available)
          .map((option) => `<div class="hint-quiet">${escapeHtml(option.aircraftId)}: ${escapeHtml(option.reason ?? '')}</div>`)
          .join('');
        const none = answering ? `<button data-action="no-air" data-id="${unit}">No air available</button>` : '';
        const danger = request.dangerClose
          ? `<div class="danger-row"><b class="danger">DANGER CLOSE requested</b>: friendlies close enough to be hit. ` +
            `<button data-action="danger-close" data-id="${unit}" data-kind="approve">Approve for 10 min</button>` +
            `<button data-action="danger-close" data-id="${unit}" data-kind="deny">Deny</button></div>`
          : request.dangerCloseUntil !== null
            ? `<div class="danger-row"><b class="danger">Danger close cleared until ${clock(request.dangerCloseUntil)}</b>. ` +
              `<button data-action="danger-close" data-id="${unit}" data-kind="deny">Revoke</button></div>`
            : '';
        return (
          `<div class="request-card${request.answer === null ? ' open' : ''}">` +
          `<div><button data-action="select-friendly" data-id="${unit}">${name}</button> <span class="hint-quiet">${Math.floor(request.ageSeconds / 60)} min ago</span></div>` +
          `<div>${ask}</div>${danger}` +
          (sends === '' && none === '' ? '' : `<div class="buttons">${sends}${none}</div>`) +
          cannot +
          `<div class="request-status">${escapeHtml(requestStatus(request, view.aircraft, clock, view.tick))}</div></div>`
        );
      });
    morphHtml(element('requests'), `<h2>Support requests</h2>${cards.join('') || '<p>None pending</p>'}`);
  }

  /**
   * Sends one thing to the simulation and, when it says something, records it in the radio log
   * as the controller's own transmission, with a brief pop-over, so no click goes unanswered.
   */
  private issue(action: PlayerAction, said: string | null = null, toUnit = false): void {
    this.config.onAction(action);
    if (said === null || this.view === null) return;
    const tick = this.view.tick;
    const arrives = toUnit ? ` (reaches them about ${clock(tick + this.config.transmitSeconds)})` : '';
    this.toasts.add({ senderId: 'YOU', level: 'sent', sender: 'Sent', text: said, point: null });
    const row = document.createElement('div');
    row.className = 'log-row outgoing main';
    row.innerHTML = `<span class="time">${clock(tick)}</span> <b>Air Ops (you)</b> <span class="kind">SENT</span><br />${escapeHtml(said + arrives)}`;
    this.log.prepend(row);
  }

  private coverWith(aircraftId: string, unitId: string): void {
    const center = this.view?.friendlies.find((friendly) => friendly.unitId === unitId)?.position.center;
    const radius = Number((document.getElementById('order-radius') as HTMLInputElement | null)?.value ?? 0) || 500;
    if (center !== undefined) this.order(aircraftId, { kind: 'Cover', unitId, center, radius });
  }

  /** Gives an aircraft a task, and says so in the log. */
  private order(aircraftId: string, order: AircraftOrder): void {
    this.issue({ kind: 'aircraftOrder', aircraftId: aircraftId as AircraftId, order }, `${aircraftId}: ${describeOrder(order, this.config.names, this.config.terrain.cellSize)}.`);
  }

  /** Answers a request with an aircraft in one go: tasks it over the unit, then promises it. */
  private sendSupport(unitId: string, aircraftId: string): void {
    const view = this.view;
    const request = view?.supportRequests.find((entry) => entry.unitId === unitId);
    const aircraft = view?.aircraft.find((entry) => entry.aircraftId === aircraftId);
    if (view === undefined || view === null || request === undefined || aircraft === undefined) return;
    const name = displayName(unitId, this.config.names);
    if (!qualifiesForSupport(aircraft, request.position.center, this.config.ackDistanceMeters)) {
      this.order(aircraftId, { kind: 'Watch', center: request.position.center, radius: SUPPORT_RADIUS });
    }
    const eta = clock(view.tick + Math.ceil(etaTo(aircraft, request.position.center)));
    this.issue({ kind: 'acknowledge', unitId, casAircraftId: aircraftId as AircraftId }, `${aircraftId} to ${name}: ${aircraftId} inbound, ETA ${eta}.`, true);
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

  /**
   * The selected aircraft: what it is doing now at the top, then the tasks it can be given, with
   * a task's settings shown only once it is picked, then the standing settings that outlast tasks.
   */
  private aircraftPanel(aircraft: AircraftTelemetryEntry): string {
    const strike = aircraft.aircraftType === 'cas';
    const view = this.view;
    const tick = view?.tick ?? 0;
    const pending = this.pendingOrder?.aircraftId === aircraft.aircraftId ? this.pendingOrder.kind : null;
    // Flares are about a place, so they're ordered from the map's right-click menu, not here.
    const kinds: readonly AreaOrderKind[] = strike ? ['Watch', 'Cover', 'Suppress', 'Strike'] : ['Watch', 'Cover'];
    const taskButtons = kinds
      .map((kind) => `<button data-action="order" data-kind="${kind}" title="${escapeHtml(ORDER_HELP[kind])}"${pending === kind ? ' class="active"' : ''}>${ORDER_LABELS[kind]}</button>`)
      .join('');
    const field = (id: string, label: string, fallback: string, min: number, step: number): string => {
      const current = (document.getElementById(id) as HTMLInputElement | null)?.value ?? fallback;
      return `<label>${label} <input id="${id}" type="number" value="${current}" min="${min}" step="${step}" /></label> `;
    };
    const fields =
      pending === null
        ? ''
        : `<div class="task-fields">` +
          (pending === 'Strike' ? '' : field('order-radius', 'Radius (m)', aircraft.aircraftType === 'recon' ? '1000' : '500', 100, 100)) +
          (pending === 'Suppress' ? field('order-minutes', 'For (min)', String(DEFAULT_SUPPRESS_MINUTES), 1, 1) : '') +
          `<span class="hint">${pending === 'Cover' ? 'Click a friendly unit on the map.' : 'Click the map to set the place.'}</span> ` +
          `<button data-action="cancel-order">Cancel</button></div>`;
    const altitudeField = document.getElementById('order-altitude') as HTMLInputElement | null;
    const editing = altitudeField !== null && document.activeElement === altitudeField;
    const altitude = editing ? altitudeField.value : String(aircraft.targetAltitudeMeters);
    const choices = <T extends string>(action: string, values: readonly T[], current: T, label: (value: T) => string, help: Readonly<Record<T, string>>): string =>
      values
        .map((value) => `<button data-action="${action}" data-id="${value}" title="${escapeHtml(help[value])}"${current === value ? ' class="active"' : ''}>${label(value)}</button>`)
        .join('');
    const weapons = choices('weapons', ['hold', 'heavy', 'guns', 'both'] as const, aircraft.weapons, (value) => WEAPONS_LABELS[value], WEAPONS_HELP);
    const risk = choices('risk', ['cautious', 'normal', 'pressOn'] as const, aircraft.risk, (value) => (value === 'pressOn' ? 'Press on' : `${value[0]?.toUpperCase()}${value.slice(1)}`), RISK_HELP);
    const station = aircraft.stationSeconds === null ? '' : ` · ${Math.floor(aircraft.stationSeconds / 60)} min on station left`;
    return (
      `<h2>${aircraft.aircraftId} · ${escapeHtml(aircraft.model)}</h2>` +
      `<p class="task-now">${escapeHtml(this.taskLine(aircraft, tick))}</p>` +
      `<p>${strike ? `Bombs ${aircraft.ammunition} · gun bursts ${aircraft.gunBursts} · ` : ''}${aircraft.flares > 0 ? `flares ${aircraft.flares} · ` : ''}fuel ${Math.round(aircraft.fuelFraction * 100)}%${station} · ` +
      `${aircraft.landed ? 'on the ground' : `altitude ${Math.round(aircraft.altitudeMeters)} m`} · visibility ${visibilityText(aircraft.visibilityMeters)}` +
      `${aircraft.damaged ? ' · damaged, returning for repair' : ''}${aircraft.aboveCloud ? ' · above cloud, cannot see the ground' : ''}</p>` +
      `<h3>New task</h3><div class="buttons">${taskButtons}<button data-action="rtb" title="Head home now.">Return to base</button></div>${fields}` +
      `<h3>Standing settings</h3>` +
      (strike ? `<div class="setting-row"><span>Weapons</span><div class="buttons">${weapons}</div></div>` : '') +
      `<div class="setting-row"><span>Risk</span><div class="buttons">${risk}</div></div>` +
      `<div class="setting-row"><span>Altitude</span><div class="buttons"><input id="order-altitude" type="number" value="${altitude}" min="100" step="100" /> m ` +
      (aircraft.manualAltitude ? '<button data-action="crew-altitude" title="Let the crew choose again.">Crew altitude</button>' : '<span class="hint-quiet">crew chooses</span>') +
      `</div></div>`
    );
  }

  /** What the aircraft is doing, in one line: its task and, on station, what the crew says. */
  private taskLine(aircraft: AircraftTelemetryEntry, tick: number): string {
    const { names, terrain } = this.config;
    switch (aircraft.status) {
      case 'ready':
        return 'Ready at base.';
      case 'turnaround':
        return `${aircraft.damaged ? 'Under repair' : 'Rearming'} until ${clock(tick + aircraft.availableInSeconds)}.`;
      case 'returning':
        return `Returning to base, ready about ${clock(tick + aircraft.availableInSeconds)}.`;
      default: {
        const order = aircraft.order;
        const task = order === null ? 'No task' : describeOrder(order, names, terrain.cellSize);
        const doing = aircraft.status === 'onStation'
          ? aircraft.casPhase === null ? 'on station' : BREVITY[aircraft.casPhase]
          : `${aircraft.status === 'takeoff' ? 'taking off' : 'en route'}${aircraft.etaSeconds === null ? '' : `, there at ${clock(tick + Math.ceil(aircraft.etaSeconds))}`}`;
        return `${task[0]?.toUpperCase()}${task.slice(1)} · ${doing}.`;
      }
    }
  }

  /**
   * A friendly unit: where it is, its open request with the same answers as its card, air to
   * cover it, the reports it can be asked for, and what it said last.
   */
  private friendlyPanel(unitId: string, view: PlayerView): string {
    const { names, terrain } = this.config;
    const marker: FriendlyMarkerView | undefined = view.friendlies.find((f) => f.unitId === unitId);
    const name = escapeHtml(displayName(unitId, names));
    const id = escapeHtml(unitId);
    const position =
      marker === undefined
        ? '<p>No position report.</p>'
        : `<p>Last reported grid ${gridRef(marker.position.center, terrain.cellSize)}, ${marker.ageSeconds}s ago.` +
          `${marker.statusReport === null ? '' : ` ${marker.statusReport.personnel} effectives, ammunition ${Math.round(marker.statusReport.ammunitionFraction * 100)}%.`}</p>`;
    const history = view.log
      .filter((m) => m.senderId === unitId)
      .slice(-4)
      .map((m) => `<li>${clock(m.receivedAt)} ${escapeHtml(radioLine(m, terrain.cellSize).text)}</li>`)
      .join('');
    const request = view.supportRequests.find((entry) => entry.unitId === unitId);
    const open = request !== undefined && (request.answer === null || request.answer.kind === 'cancelled');
    const support =
      request === undefined
        ? ''
        : `<h3>Support request</h3><p class="request-status">${escapeHtml(requestStatus(request, view.aircraft, clock, view.tick))}</p>` +
          (open
            ? `<div class="buttons">${supportOptions(request, view.aircraft, clock, view.tick)
                .filter((option) => option.available)
                .map((option) => `<button class="primary" data-action="send-support" data-id="${id}" data-kind="${escapeHtml(option.aircraftId)}">Send ${escapeHtml(option.aircraftId)}</button>`)
                .join('')}<button data-action="no-air" data-id="${id}">No air available</button></div>`
            : '');
    const danger = marker?.dangerCloseUntil === null || marker === undefined
      ? ''
      : `<p><b class="danger">Danger close cleared until ${clock(marker.dangerCloseUntil)}</b> <button data-action="danger-close" data-id="${id}" data-kind="deny">Revoke</button></p>`;
    const cover = view.aircraft
      .filter((a) => canFire(a) && !(a.order?.kind === 'Cover' && a.order.unitId === unitId))
      .map((a) => `<button data-action="cover" data-id="${id}" data-kind="${escapeHtml(a.aircraftId)}" title="${escapeHtml(ORDER_HELP.Cover)}">Cover with ${escapeHtml(a.aircraftId)}</button>`)
      .join('');
    const report = marker?.statusReport;
    const survival =
      unitId === this.config.survivorId
        ? `<h3>Survival</h3><p>${report?.waterMinutes === undefined ? 'Water and battery not reported yet: ask for a SITREP.' : `Water for about ${Math.floor(report.waterMinutes / 60)} h ${report.waterMinutes % 60} min, ${report.battery ?? 0} radio calls left, as of ${clock(report.receivedAt)}.`}</p>` +
          '<p class="hint">Every call uses battery and can give its position away to the enemy. It stays silent unless asked.</p>'
        : '';
    return (
      `<h2>${name}</h2>${position}${survival}${danger}${support}` +
      (marker === undefined || cover === '' ? '' : `<h3>Air cover</h3><div class="buttons">${cover}</div>`) +
      `<h3>Ask for</h3><div class="buttons">` +
      `<button data-action="request" data-id="${id}" data-kind="position">Position</button>` +
      `<button data-action="request" data-id="${id}" data-kind="sitrep">SITREP</button>` +
      `<button data-action="request" data-id="${id}" data-kind="contact">Contact update</button></div>` +
      `<h3>Last heard</h3><ul class="history">${history}</ul>`
    );
  }

  private contactHistory(marker: ContactMarker): string {
    const status = statusText(marker.status, marker.estimatedLosses);
    const sources = marker.members.map((m) => displayName(m.contact.provenance.sourceId, this.config.names));
    const merged =
      marker.members.length === 0
        ? ''
        : `<p>On this track with ${marker.members.length} other ${marker.members.length === 1 ? 'report' : 'reports'}, from ${escapeHtml(sources.join(', '))}</p>` +
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
      `<h2>${marker.trackNumber === null ? `Report ${escapeHtml(contact.contactId)}` : `Track TN ${marker.trackNumber}`}</h2>` +
      (marker.ambiguous ? '<p class="hint">Another track could also have taken one of these reports: it may be two groups.</p>' : '') +
      `<p>${marker.viaAircraft ? 'Air observation' : 'Ground report'} · ${escapeHtml(displayName(contact.provenance.sourceId, names))}</p>` +
      `<p>Grid ${gridRef(contact.position.center, terrain.cellSize)} · ${strengthText(contact.strength)} · ${contact.identification}</p>` +
      `<p>${contact.confidence} confidence · rated ${admiraltyRating(marker)} · observed ${clock(contact.position.observedAt)}</p>` +
      conditionLine(marker) +
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
    element('tracks').hidden = showing !== 'tracks';
    morphHtml(
      element('side-tabs'),
      `<button data-action="tab" data-id="radio"${showing === 'radio' ? ' class="active"' : ''}>Radio</button>` +
        `<button data-action="tab" data-id="tracks"${showing === 'tracks' ? ' class="active"' : ''}>Tracks</button>` +
        `<button data-action="tab" data-id="summary"${showing === 'summary' ? ' class="active"' : ''}>Summary</button>` +
        (showing === 'radio' ? `<span class="radio-filter">${filter('main', 'Main')}${filter('all', 'All')}</span>` : ''),
    );
    if (showing === 'summary') morphHtml(element('summary'), this.summaryHtml(view, run));
    if (showing === 'tracks') morphHtml(element('tracks'), this.tracksHtml(view));
  }

  /** Every track in one table, sorted as asked. A row selects the track and centers the map on it. */
  private tracksHtml(view: PlayerView): string {
    const { terrain } = this.config;
    const sort = (id: TrackSort, label: string): string =>
      `<button data-action="track-sort" data-id="${id}"${this.trackSort === id ? ' class="active"' : ''}>${label}</button>`;
    const selected = this.selection?.kind === 'contact' ? this.selection.key : null;
    const rows = sortedTracks(view.contacts, this.trackSort).map((marker) => {
      const { contact } = marker;
      const condition = contactCondition(marker.estimatedLosses, contact.strength);
      const state = marker.status === 'destroyed'
        ? 'destroyed'
        : marker.status === 'not-found'
          ? 'not found'
          : condition === null
            ? ''
            : condition.probablyDestroyed
              ? 'probably destroyed'
              : condition.condition === 'combatIneffective'
                ? 'combat-ineffective'
                : condition.condition;
      const what = `${contact.identification === 'hostile' ? (contact.confidence === 'low' ? 'suspect' : 'hostile') : 'unknown'} ${strengthText(contact.strength).replace('-sized', '')}`;
      const weapons = weaponTag(contact.observedWeapons) ?? '';
      const antiAir = contact.observedWeapons.some(isAntiAir);
      const classes = ['track-row', marker.stale ? 'stale' : '', marker.status === 'destroyed' ? 'destroyed' : '', selected === marker.key ? 'active' : ''].filter((c) => c !== '').join(' ');
      const center = contact.position.center;
      return (
        `<tr class="${classes}" data-action="select-track" data-id="${escapeHtml(marker.key)}" data-x="${center.x}" data-y="${center.y}">` +
        `<td>${marker.trackNumber === null ? '—' : marker.trackNumber}</td><td>${escapeHtml(what)}${marker.engaging ? ' · firing' : ''}</td>` +
        `<td class="${antiAir ? 'aa' : ''}">${escapeHtml(weapons)}</td><td>${escapeHtml(state)}</td>` +
        `<td>${clock(contact.position.observedAt)}${marker.stale ? ' ⏲' : ''}</td><td>${admiraltyRating(marker)}</td>` +
        `<td>${gridRef(center, terrain.cellSize)}</td></tr>`
      );
    });
    const count = view.contacts.filter((marker) => marker.contact.identification !== 'friendly').length;
    return (
      `<div class="buttons">Sort by ${sort('threat', 'Threat')}${sort('age', 'Newest')}${sort('condition', 'Least damaged')}</div>` +
      `<p class="hint-quiet">${count} tracks. Air defense first under Threat. ⏲ not seen for two minutes or more. Click a row to select it and center the map.</p>` +
      `<table><tr><th>TN</th><th>What</th><th>Weapons</th><th>Condition</th><th>Seen</th><th>Rating</th><th>Grid</th></tr>${rows.join('')}</table>`
    );
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
      `<p>Reported losses: est. ${rangeText(summary.losses)} from aircrews · ${summary.confirmedDestroyed} confirmed destroyed</p>` +
      `<p>Claimed by ground units: ${view.groundClaims} on the tracks shown. Units in a fight count high.</p>` +
      `<p>Unlocated: est. ${rangeText(summary.unlocated)}</p>` +
      (sectors === '' ? '' : `<table>${sectors}</table>`) +
      `<p>Air threat: ${threats === '' ? 'none observed' : escapeHtml(threats)}</p>` +
      `<h3>Friendly, last reported</h3><ul>${friendlies}</ul>` +
      `<h3>${escapeHtml(this.config.summary.areaLabel)}</h3><p>Within ${this.config.summary.ratioRadiusMeters / 1000} km: enemy ${rangeText(summary.threatened)} ` +
      `against ${summary.defenders} defenders${ratio === null ? '' : ` (${ratio})`}</p>` +
      `<h3>Air</h3><p>${summary.strikes} strikes · ${summary.aircraftHits} hits taken · ${summary.damagedNow} damaged now</p>` +
      statusBoardHtml(view) +
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
