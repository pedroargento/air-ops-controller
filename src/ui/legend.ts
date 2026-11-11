import { BREVITY, CONDITION_COLORS, ECHELON_MARKS, type Condition, type Echelon } from './map-conventions';
import { drawUnitSymbol, haloText, type UnitSymbol } from './symbols';
import { drawFireArrow, drawFireWedge, FRIENDLY_FIRE, HOSTILE_FIRE } from './fire-draw';

/*
 * The map key: every symbol drawn by the same code as the map, with what it means, and the
 * radio words and report conventions the game borrows. Long on purpose: it's opened when
 * wanted and closed again.
 */

type Sample = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const PAPER = '#f0ecdc';
const INK = '#141414';

const unit = (overrides: Partial<UnitSymbol>): UnitSymbol => ({
  affiliation: 'hostile',
  icon: 'infantry',
  airDefense: false,
  echelon: null,
  reduced: false,
  condition: null,
  destroyed: null,
  dashed: false,
  hollow: false,
  selected: false,
  headingRad: null,
  right: [],
  ...overrides,
});

const symbol = (overrides: Partial<UnitSymbol>): Sample => (ctx, _width, height) => drawUnitSymbol(ctx, { x: 22, y: Math.min(height / 2 + 5, 22) }, unit(overrides));

const condition = (name: Condition, lostShare: number): Partial<UnitSymbol> => ({
  reduced: true,
  condition: { condition: name, lostShare, probablyDestroyed: false },
});

const line = (color: string, width: number, casing: string | null = null): Sample => (ctx, w, h) => {
  for (const [stroke, lineWidth] of casing === null ? [[color, width]] : [[casing, width + 2], [color, width]]) {
    ctx.strokeStyle = stroke as string;
    ctx.lineWidth = lineWidth as number;
    ctx.beginPath();
    ctx.moveTo(4, h - 6);
    ctx.bezierCurveTo(w / 3, 4, (2 * w) / 3, h - 4, w - 4, 6);
    ctx.stroke();
  }
};

const swatch = (color: string): Sample => (ctx, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(6, 4, w - 12, h - 8);
};

const SIZE_WORDS: Readonly<Record<Echelon, string>> = {
  team: 'ø team: up to 5 men.',
  squad: '• squad: about a dozen.',
  section: '•• section: up to 20.',
  platoon: '••• platoon: up to 50.',
  company: '| company: up to 150.',
  battalion: '|| battalion: more.',
};

const SAMPLES: readonly (readonly [string, readonly (readonly [Sample, string])[]])[] = [
  [
    'Units (NATO APP-6)',
    [
      [symbol({ affiliation: 'friend', echelon: 'platoon' }), 'Friendly platoon, infantry. Its designation is beside it.'],
      [symbol({ affiliation: 'friend', dashed: true }), 'Friendly unit not heard from lately: dashed frame.'],
      [symbol({ echelon: 'squad' }), 'Hostile squad, infantry: red diamond.'],
      [symbol({ affiliation: 'suspect', right: [{ text: '?', color: '#b0201a' }] }), 'Suspect: probably hostile, reported with low confidence.'],
      [symbol({ affiliation: 'unknown', icon: null }), 'Unidentified: seen, but nobody could tell whose.'],
      [symbol({ icon: 'armour' }), 'Vehicle.'],
      [symbol({ airDefense: true, right: [{ text: 'MP', color: '#ff3df0' }] }), 'Air defense seen: dome inside, AAA or MP (MANPADS) in magenta. Selecting it shows its threat ring.'],
      [symbol({ right: [{ text: 'MG' }] }), 'Machine gun seen. No tag means weapons not seen, not that there are none.'],
      [symbol({ headingRad: 0 }), 'Seen moving: the arrow points the way it was heading.'],
      [symbol({ dashed: true, right: [{ text: '14:05', color: '#444444' }] }), 'Not seen for two minutes or more: last known position, with when it was seen. Where it went is your estimate.'],
      [symbol({ hollow: true, right: [{ text: 'NOT FOUND', color: '#555555' }] }), 'Looked for and not found. It may still be hidden there.'],
      [symbol({ right: [{ text: '×3' }] }), 'A track built from three reports. Selecting it lists them; you can split them apart.'],
    ],
  ],
  [
    'Size marks (above the symbol)',
    (Object.entries(ECHELON_MARKS) as [Echelon, string][]).map(([echelon]) => [symbol({ echelon }), SIZE_WORDS[echelon]] as const),
  ],
  [
    'Losses and condition',
    [
      [symbol(condition('capable', 0.05)), '(−) losses claimed. Green bar: under a tenth of its estimated strength.'],
      [symbol(condition('neutralized', 0.2)), 'Yellow: a tenth to three tenths claimed. Neutralized, out of action for a while.'],
      [symbol(condition('combatIneffective', 0.5)), 'Red: three tenths or more. Combat-ineffective, which NATO doctrine calls destroyed.'],
      [symbol({ destroyed: 'probable', condition: { condition: 'combatIneffective', lostShare: 0.95, probablyDestroyed: true } }), 'Probably destroyed: claims add up to the whole unit, but nobody saw it dead.'],
      [symbol({ destroyed: 'confirmed' }), 'Destroyed: a crew reported it.'],
    ],
  ],
  [
    'Map',
    [
      [swatch('#f0ecdc'), 'Open ground.'],
      [swatch('#bedaa6'), 'Woods. Darker green is jungle. Both hide units from the air.'],
      [swatch('#c4bcb2'), 'Built-up ground.'],
      [line('rgb(214,96,52)', 3.5, 'rgb(110,50,30)'), 'Road.'],
      [line('rgb(70,140,205)', 2.5), 'Stream.'],
      [line('rgba(150,95,40,0.75)', 1), 'Contour every 20 m; bolder and labeled every 100 m.'],
      [
        (ctx, _w, h) => {
          ctx.fillStyle = '#5a3a1a';
          ctx.beginPath();
          ctx.arc(10, h / 2, 2, 0, Math.PI * 2);
          ctx.fill();
          haloText(ctx, '280', 14, h / 2 - 2, '#5a3a1a', 'bold 10px sans-serif');
        },
        'Spot height on a summit, in meters.',
      ],
      [
        (ctx, _w, h) => {
          haloText(ctx, '280', 18, h / 2 + 6, '#1d3f8f', 'bold 16px sans-serif', 'center');
          haloText(ctx, '320', 50, h / 2 + 6, '#c41e1e', 'bold 16px sans-serif', 'center');
        },
        'With an aircraft selected: the highest ground in each 1 km square. Red where it is above the aircraft\'s set altitude.',
      ],
      [
        (ctx, _w, h) => {
          ctx.fillStyle = '#d8d8d8';
          ctx.strokeStyle = '#6a6a6a';
          for (const [dx, dy, r] of [[0, 0, 6], [5, -3, 4], [-5, -2, 4]] as const) {
            ctx.beginPath();
            ctx.arc(20 + dx, h / 2 + 3 + dy, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        },
        'Smoke a platoon threw on a target for the aircraft, once a crew sees it.',
      ],
      [
        (ctx, _w, h) => {
          ctx.fillStyle = 'rgba(6,12,32,0.5)';
          ctx.fillRect(0, 0, 110, h);
          const glow = ctx.createRadialGradient(30, h / 2, 0, 30, h / 2, 22);
          glow.addColorStop(0, 'rgba(240,236,220,0.9)');
          glow.addColorStop(1, 'rgba(240,236,220,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(8, 0, 44, h);
          ctx.fillStyle = '#fff3a0';
          ctx.strokeStyle = '#7a5a00';
          ctx.beginPath();
          for (let i = 0; i < 10; i += 1) {
            const angle = (i * Math.PI) / 5 - Math.PI / 2;
            const reach = i % 2 === 0 ? 7 : 3;
            const [x, y] = [30 + Math.cos(angle) * reach, h / 2 + Math.sin(angle) * reach];
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        },
        'Night darkens the map. A flare you dropped, or one of your platoons fired, lights the ground around it, with the minutes it has left. It lights friends there too.',
      ],
      [
        (ctx, _w, h) => {
          ctx.strokeStyle = '#ffaa3c';
          ctx.fillStyle = 'rgba(255,170,60,0.15)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          ctx.arc(22, h / 2, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        },
        'A point you reported, such as a suspected kill zone (right-click the map).',
      ],
      [
        (ctx, _w, h) => {
          ctx.strokeStyle = '#c0281e';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.arc(22, h / 2, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        },
        'Several fresh hostile reports close together, with their count and combined strength.',
      ],
      [
        (ctx, _w, h) => {
          ctx.fillStyle = '#ffd24a';
          ctx.strokeStyle = INK;
          ctx.beginPath();
          ctx.moveTo(18, h - 4);
          ctx.lineTo(18, 4);
          ctx.lineTo(30, 9);
          ctx.lineTo(18, 14);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        },
        'Troops in contact (TIC) reported here.',
      ],
      [
        (ctx, _w, h) => {
          ctx.strokeStyle = '#ff4d4d';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(14, h / 2 - 7);
          ctx.lineTo(28, h / 2 + 7);
          ctx.moveTo(28, h / 2 - 7);
          ctx.lineTo(14, h / 2 + 7);
          ctx.stroke();
        },
        'Where a crew thinks ground fire came from.',
      ],
      [
        (ctx, _w, h) => {
          ctx.fillStyle = '#ff7a1a';
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(22, h / 2, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        },
        'A strike or gun pass landing. Grey if the crew saw no effect.',
      ],
      [
        (ctx, _w, h) => {
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(22, h / 2, 11, 0, Math.PI * 2);
          ctx.stroke();
        },
        'Blinking ring: this unit or aircraft just spoke on the radio. Red if urgent.',
      ],
      [
        (ctx, _w, h) => {
          ctx.save();
          ctx.translate(14, h / 2);
          ctx.fillStyle = '#80e0ff';
          ctx.strokeStyle = '#0b2a4a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-7, 10);
          ctx.lineTo(-2.5, 0);
          ctx.lineTo(-7, -10);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          haloText(ctx, 'CAS-1', 30, h / 2 - 4, '#0b2a4a', 'bold 10px monospace');
          haloText(ctx, '650m WATCH', 30, h / 2 + 7, '#0b2a4a', '9px monospace');
        },
        'Aircraft with its data block: callsign, altitude and task, then what the crew says it\'s doing.',
      ],
    ],
  ],
  [
    'Fire on the ground',
    [
      [
        (ctx, w, h) => drawFireArrow(ctx, { x: 8, y: h / 2 }, { x: w - 10, y: h / 2 }, { color: HOSTILE_FIRE, seen: true, heavy: false, opacity: 1 }),
        'Solid arrow: a crew saw this fire. It points from the shooter to where the fire lands. Red is enemy fire, blue is friendly.',
      ],
      [
        (ctx, w, h) => drawFireArrow(ctx, { x: 8, y: h / 2 }, { x: w - 10, y: h / 2 }, { color: FRIENDLY_FIRE, seen: false, heavy: false, opacity: 1 }),
        'Dashed arrow: a unit reported it: fire it is taking from a contact it can see, or the contact it is firing at.',
      ],
      [
        (ctx, w, h) => drawFireArrow(ctx, { x: 8, y: h / 2 }, { x: w - 10, y: h / 2 }, { color: HOSTILE_FIRE, seen: false, heavy: true, opacity: 1 }),
        'Thick arrow: heavy fire. The unit is losing men or is pinned down.',
      ],
      [
        (ctx, w, h) => drawFireWedge(ctx, [{ x: w - 8, y: 6 }, { x: 14, y: h / 2 }, { x: w - 8, y: h - 6 }], { color: HOSTILE_FIRE, seen: false, heavy: false, opacity: 1 }),
        'Wedge: a unit under fire from a shooter it can\'t see. It points at the unit and opens toward where the fire seems to come from.',
      ],
      [
        (ctx, _w, h) => drawFireArrow(ctx, { x: 10, y: h / 2 + 8 }, { x: 40, y: h / 2 - 8 }, { color: HOSTILE_FIRE, seen: true, heavy: false, opacity: 1 }),
        'Short stub: a crew saw a unit firing, but not whom at. It shows only the direction.',
      ],
      [
        symbol({ affiliation: 'friend', echelon: 'platoon', right: [{ text: 'UNDER FIRE', color: HOSTILE_FIRE }] }),
        'UNDER FIRE or HEAVY FIRE beside a friendly unit: it says so, or a crew saw fire landing on it. Fresh fire shows for everyone; select a unit or track to see its older fire too.',
      ],
    ],
  ],
];


const BREVITY_WORDS: Readonly<Record<string, string>> = {
  [BREVITY.searching]: 'Searching its area, nothing found yet.',
  [BREVITY.identifying]: 'Something seen, not yet identified.',
  [BREVITY['target-acquired']]: 'Target in sight.',
  [BREVITY['attack-run']]: 'Running in to attack.',
  [BREVITY['breaking-off']]: 'Breaking away from ground fire.',
  [BREVITY['holding-danger-close']]: 'Holding fire: friendly troops too close to the target.',
  [BREVITY.suppressing]: 'Flying a suppression mission.',
  [BREVITY['weapons-hold']]: 'On weapons hold: picks no targets of its own.',
  [BREVITY['out-of-ordnance']]: 'Nothing left to fire.',
  JOKER: 'About ten minutes of station time left: plan a relief.',
  BINGO: 'Fuel for the trip home only. It is leaving now.',
  'CHECK FIRE': 'Stop firing: friendly troops are being hit.',
  'DANGER CLOSE': 'Friendly troops close enough to the target to be hit. Only you can clear it.',
  'WHEELS DOWN': 'A helicopter has landed for a pickup. It is an easy target until it lifts.',
  'LIFTING OFF': 'The crew left the pickup under fire, by its risk limit. Boarding starts again next time; wounded already aboard stay aboard.',
  'SURVIVOR ABOARD': 'The pickup is made. It flies home; the rescue succeeds when it lands there.',
  'WOUNDED ABOARD': 'A medevac is full, or has everyone within reach. It flies them to the hospital at base.',
};

const TASK_WORDS: readonly (readonly [string, string])[] = [
  ['WATCH', 'Over an area. Recon searches it; a strike aircraft engages what it finds, as weapons control allows.'],
  ['COVER', 'Watching ahead of a friendly platoon, following it.'],
  ['SUPP', 'Suppressing an area with guns until a set time.'],
  ['STRIKE', 'One bomb pass on a place, then watching it.'],
  ['ILLUM', 'Keeping a flare burning over an area at night. It lights friends there too.'],
  ['PICKUP', 'A rescue helicopter landing at a point and waiting while survivors board.'],
  ['RTB', 'Returning to base.'],
];

const REPORT_WORDS: readonly (readonly [string, string])[] = [
  ['TN 4001', 'Track number: air operations\' belief that several reports are one enemy group.'],
  ['B2', 'Admiralty rating. The letter is the source: B an aircraft, C a ground unit. The figure is the information: 1 confirmed by another source, 2 to 4 by confidence.'],
  ['Spot', 'A contact report in SALUTE order: size and unit, activity, location, time, equipment.'],
  ['9-line', 'A support request: the target, its size, whether it will be marked with smoke, and where the friendlies are.'],
  ['MEDEVAC', 'A 9-line medevac request: how many wounded, where to land, and whether the enemy is near. Every minute they wait, more die.'],
  ['Claims', 'Casualties a unit believes it caused. Units in a fight count high; the debrief shows the truth.'],
];

const SHORTCUTS: readonly (readonly [string, string])[] = [
  ['1–9', 'Select an aircraft.'],
  ['W C S K', 'Give the selected aircraft a task: watch, cover, suppress, strike. Then click the map, or a friendly unit to cover.'],
  ['R R', 'Send the selected aircraft home: press twice within three seconds.'],
  ['Space', 'Pause or resume.'],
  ['+ −', 'Faster or slower.'],
  ['E', 'Run on fast until something needs you, then pause: a request, an aircraft arriving or out of ordnance, a first contact, or anything above routine on the radio.'],
  ['N', 'Select the unit whose request has waited longest without an answer. Press again for the next.'],
  ['F', 'Forward the selected contact to the units ticked, or to every unit if none is.'],
  ['Esc', 'Cancel picking a place, close menus and the key.'],
  ['Right-click', 'What can be done right there: on a unit, a contact or open ground. Illuminate with flares is here.'],
  ['T', 'Open the timeline: the battle as you knew it at any earlier moment. The battle pauses while it is open.'],
  ['?', 'Open or close this key.'],
];

function canvasCell(index: string): string {
  return `<canvas class="legend-sample" width="110" height="50" data-sample="${index}"></canvas>`;
}

function textRows(title: string, rows: readonly (readonly [string, string])[]): string {
  const body = rows.map(([term, words]) => `<div class="legend-row"><b class="legend-term">${term}</b><span>${words}</span></div>`).join('');
  return `<h3>${title}</h3>${body}`;
}

export function legendHtml(): string {
  const sections = SAMPLES.map(
    ([title, rows], section) =>
      `<h3>${title}</h3>` + rows.map(([, words], row) => `<div class="legend-row">${canvasCell(`${section}/${row}`)}<span>${words}</span></div>`).join(''),
  ).join('');
  const brevity = Object.entries(BREVITY_WORDS) as [string, string][];
  return (
    `<div class="legend-head"><h2>Key</h2><button data-action="legend">Close</button></div>` +
    `<div class="legend-columns"><div>${sections}</div><div>` +
    textRows('Radio words (brevity)', brevity) +
    textRows('Aircraft tasks', TASK_WORDS) +
    textRows('Reports', REPORT_WORDS) +
    textRows('Shortcuts', SHORTCUTS) +
    `<h3>Condition colors</h3><div class="legend-row"><span>${(Object.entries(CONDITION_COLORS) as [Condition, string][])
      .map(([name, color]) => `<b style="color:${color}">■</b> ${name === 'combatIneffective' ? 'combat-ineffective' : name}`)
      .join(' · ')}</span></div>` +
    `</div></div>`
  );
}

/** Draws every sample into its canvas, on map paper, so symbols look as they do on the map. */
export function paintLegend(root: HTMLElement): void {
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-sample]')) {
    const [section, row] = (canvas.dataset['sample'] ?? '').split('/').map(Number) as [number, number];
    const sample = SAMPLES[section]?.[1][row]?.[0];
    const ctx = canvas.getContext('2d');
    if (sample === undefined || ctx === null) continue;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sample(ctx, canvas.width, canvas.height);
  }
}
