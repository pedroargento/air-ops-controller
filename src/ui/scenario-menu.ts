/*
 * The scenario menu: what a controller is told before choosing a shift. Each card links to the
 * scenario's URL, which stays the record of what was played, so a run can be shared and replayed.
 */

export type ScenarioCard = Readonly<{
  id: string;
  name: string;
  summary: string;
  objective: string;
  /** Local start time, as written in the scenario: 0545. */
  startTime: string;
  light: 'day' | 'twilight' | 'night';
  durationSeconds: number;
  /** The mission can finish well before its time limit, as a rescue does. */
  endsEarly: boolean;
  aircraft: readonly string[];
}>;

/**
 * Easiest first, with a word on how hard each is. From the best bot's wins over 300 seeds on
 * 2026-11-10: 292, 239, 236, 187, 120 and 56. A scenario not listed here goes last, unlabeled.
 */
const DIFFICULTY: readonly (readonly [id: string, label: string])[] = [
  ['downed-pilot', 'Introduction'],
  ['find-them', 'Easy'],
  ['outpost-under-pressure', 'Standard'],
  ['valley-road', 'Standard'],
  ['outpost-night', 'Hard'],
  ['overwatch', 'Very hard'],
];

function difficultyRank(id: string): number {
  const rank = DIFFICULTY.findIndex(([known]) => known === id);
  return rank < 0 ? DIFFICULTY.length : rank;
}

export function difficultyLabel(id: string): string | null {
  return DIFFICULTY.find(([known]) => known === id)?.[1] ?? null;
}

/** Stable, so unlisted scenarios keep the order they came in. */
export function byDifficulty(cards: readonly ScenarioCard[]): readonly ScenarioCard[] {
  return [...cards].sort((a, b) => difficultyRank(a.id) - difficultyRank(b.id));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** "75 min", or "16 h" for a long rescue. */
export function lengthText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Counts repeats: "2× A-1E, O-1E". */
export function aircraftText(aircraft: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of aircraft) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${count}× ${name}` : name)).join(', ');
}

/** The URL that plays a scenario, with a fixed seed if one is given. */
export function playUrl(id: string, seed: string): string {
  const query = new URLSearchParams({ scenario: id });
  if (/^\d+$/.test(seed.trim())) query.set('seed', seed.trim());
  return `?${query.toString()}`;
}

/** A battle left unfinished, which the menu offers to take up again. */
export type ResumeOffer = Readonly<{ id: string; seed: number; elapsedSeconds: number }>;

/** The URL that takes up a saved battle where it was left. */
export function resumeUrl(offer: ResumeOffer): string {
  return `?${new URLSearchParams({ scenario: offer.id, seed: String(offer.seed), resume: '1' }).toString()}`;
}

function resumeHtml(offer: ResumeOffer | null, cards: readonly ScenarioCard[]): string {
  const card = offer === null ? undefined : cards.find((entry) => entry.id === offer.id);
  if (offer === null || card === undefined) return '';
  return (
    `<a class="scenario-card resume" href="${escapeHtml(resumeUrl(offer))}">` +
    `<span class="scenario-head"><b>Resume ${escapeHtml(card.name)}</b></span>` +
    `<span class="scenario-facts">${Math.floor(offer.elapsedSeconds / 60)} min in · seed ${offer.seed} · starting any battle replaces it</span></a>`
  );
}

export function renderScenarioMenu(root: HTMLElement, cards: readonly ScenarioCard[], lastPlayed: string | null, resume: ResumeOffer | null = null): void {
  const items = byDifficulty(cards)
    .map(
      (card) =>
        `<li><button class="scenario-card${card.id === lastPlayed ? ' last' : ''}" data-id="${escapeHtml(card.id)}">` +
        `<span class="scenario-head"><b>${escapeHtml(card.name)}</b><span class="light-tag ${card.light}">${card.light === 'day' ? 'Day' : card.light === 'night' ? 'Night' : 'Twilight'} · ${escapeHtml(card.startTime)}</span></span>` +
        `<span class="scenario-objective">${escapeHtml(card.objective)}</span>` +
        `<span class="scenario-summary">${escapeHtml(card.summary)}</span>` +
        `<span class="scenario-facts">${difficultyLabel(card.id) === null ? '' : `${difficultyLabel(card.id)} · `}${card.endsEarly ? 'up to ' : ''}${lengthText(card.durationSeconds)} · ${escapeHtml(aircraftText(card.aircraft))}${card.id === lastPlayed ? ' · last played' : ''}</span>` +
        '</button></li>',
    )
    .join('');
  root.innerHTML =
    '<div class="menu-box"><h1>Air Operations</h1><p class="hint">Choose a shift. You control the air; the troops on the ground fight their own battle.</p>' +
    resumeHtml(resume, cards) +
    `<ul class="scenario-list">${items}</ul>` +
    '<label class="seed">Seed <input id="menu-seed" inputmode="numeric" placeholder="random" size="10" /> <span class="hint">the same seed plays the same battle</span></label></div>';
  root.hidden = false;
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.scenario-card');
    if (button === null) return;
    const seed = (root.querySelector('#menu-seed') as HTMLInputElement).value;
    location.href = playUrl(button.dataset['id'] ?? '', seed);
  });
}
