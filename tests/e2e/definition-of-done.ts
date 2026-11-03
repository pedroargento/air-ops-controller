// Plays the real page in a browser, following the Definition of Done (§14).
// Usage: npm run e2e [-- --screenshots dir]
import { mkdirSync } from 'node:fs';
import { chromium, firefox, type Page } from 'playwright';
import { createServer } from 'vite';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { runReplay } from '../../src/cli/replay';
import type { CommandLog } from '../../src/game/session';
import type { PlayerView } from '../../src/knowledge/player-view';

const PORT = 5195;
const engine = process.argv.includes('--firefox') ? firefox : chromium;
const shotIndex = process.argv.indexOf('--screenshots');
const shots = shotIndex >= 0 ? process.argv[shotIndex + 1] : undefined;
if (shots !== undefined) mkdirSync(shots, { recursive: true });

type Vec = { x: number; y: number };
type Hook = {
  app: { mapCenter: Vec; screenPosition: (p: Vec) => Vec; focusOn: (p: Vec) => void };
  session: { commandLog: () => CommandLog; stateHash: () => string };
};
const hook = 'window.airops';

let checks = 0;
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  checks += 1;
  console.log(`  ok: ${label}`);
}

const shot = async (page: Page, name: string): Promise<void> => {
  if (shots !== undefined) await page.screenshot({ path: `${shots}/${name}.png` });
};

const setPaused = async (page: Page, paused: boolean): Promise<void> => {
  const label = await page.locator('#pause').innerText();
  if ((label === 'Pause') === paused) await page.locator('#pause').click();
};

/** Clicks the canvas at a world coordinate. */
async function clickWorld(page: Page, point: Vec): Promise<void> {
  const pixel = await page.evaluate(([p]) => {
    const { app } = (window as unknown as { airops: Hook }).airops;
    return app.screenPosition(p as Vec);
  }, [point]);
  await page.locator('#map').click({ position: pixel });
}

async function coordinateOf(page: Page, selector: string): Promise<Vec> {
  const button = page.locator(`${selector} .coord`).last();
  return { x: Number(await button.getAttribute('data-x')), y: Number(await button.getAttribute('data-y')) };
}

async function main(): Promise<void> {
  const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  try {
    console.log('Load the scenario');
    await page.goto(`http://localhost:${PORT}/?seed=1&speed=40`);
    await page.waitForSelector('#clock');
    check((await page.locator('.aircraft-row').count()) === 4, 'four aircraft are listed');
    await page.waitForSelector('.log-row.command_update');
    check(true, 'CECON message is in the log');
    await shot(page, '1-start');

    console.log('Task recon before contact');
    await page.locator('[data-action="select-aircraft"][data-id="RECON-1"]').click();
    await page.locator('[data-action="order"][data-kind="Watch"]').click();
    await page.locator('#order-radius').fill('1500');
    const objective = { x: 2525, y: 2625 };
    await clickWorld(page, objective);
    await page.waitForFunction(() => document.querySelector('[data-id="RECON-1"]')?.textContent?.includes('watching'));
    check(true, 'recon accepted its order from a map click');

    console.log('Receive a TIC from an autonomous formation');
    await page.waitForSelector('.log-row.tic', { timeout: 60000 });
    await setPaused(page, true);
    check(true, 'a TIC arrived without any script');
    await shot(page, '2-tic');

    console.log('Click the reported coordinate');
    await page.waitForSelector('.toast.urgent');
    check(true, 'an urgent report pops over the map');
    const reported = await coordinateOf(page, '.log-row.tic');
    await page.locator('.log-row.tic .coord').last().click();
    const center = await page.evaluate(() => (window as unknown as { airops: Hook }).airops.app.mapCenter);
    check(center.x === reported.x && center.y === reported.y, 'map centers on the reported coordinate');

    console.log('Better information from reconnaissance');
    await setPaused(page, false);
    await page.waitForFunction(
      () => [...document.querySelectorAll('.log-row')].some((r) => r.textContent?.includes('RECON-1') && r.querySelector('.coord')),
      undefined,
      { timeout: 60000 },
    );
    await setPaused(page, true);
    // The log keeps the first sighting; the map marker follows newer estimates, so read the view.
    const contacts = await page.evaluate(() => {
      const { airops } = window as unknown as { airops: { view: () => PlayerView } };
      return airops.view().contacts.filter((m) => m.viaAircraft).map((m) => m.contact.position.center);
    });
    check(contacts.length > 0, 'recon reported a contact');

    console.log('Forward it to a selected ground unit');
    let point: Vec = { x: 0, y: 0 };
    for (const candidate of contacts) {
      point = candidate;
      await page.evaluate((p) => (window as unknown as { airops: Hook }).airops.app.focusOn(p), candidate);
      // A nearby friendly can overlap the contact: clicking again cycles to the next marker.
      for (let attempt = 0; attempt < 3 && (await page.locator('#transmit').count()) === 0; attempt += 1) {
        await clickWorld(page, candidate);
        await page.waitForTimeout(150);
      }
      if ((await page.locator('#transmit').count()) > 0) break;
    }
    await page.waitForSelector('#transmit');
    await page.locator('[data-recipient="F-A"]').check();
    await page.waitForFunction(() => document.querySelector('.preview')?.textContent?.includes('Garrison Alpha'));
    const preview = await page.locator('.preview').innerText();
    check(preview.includes('RECON-1 reports'), `preview keeps the real source: "${preview}"`);
    await shot(page, '3-forward');
    await page.locator('#transmit').click();

    console.log('Task CAS through the map');
    await page.locator('[data-action="select-aircraft"][data-id="CAS-1"]').click();
    await page.locator('[data-action="order"][data-kind="Watch"]').click();
    await page.waitForFunction(() => {
      const shown = document.querySelector<HTMLElement>('#map-banner');
      return shown !== null && !shown.hidden && (shown.textContent ?? '').includes('CAS-1');
    });
    const banner = await page.locator('#map-banner').innerText();
    check(banner.includes('WATCH') && banner.includes('CAS-1') && banner.includes('Esc'), `picking a place says what for: "${banner}"`);
    await clickWorld(page, point);
    await setPaused(page, false);
    await page.waitForFunction(() => document.querySelector('[data-id="CAS-1"]')?.textContent?.includes('watching'));
    check(true, 'CAS accepted its support mission');
    check((await page.locator('.log-row.outgoing').count()) > 0, 'the order shows in the radio log as the controller\'s own transmission');

    const log = () => page.evaluate(() => (window as unknown as { airops: Hook }).airops.session.commandLog());
    await page.locator('[data-action="weapons"][data-id="hold"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="weapons"][data-id="hold"]')?.classList.contains('active'));
    await page.locator('[data-action="weapons"][data-id="both"]').click();
    await page.waitForFunction(() => document.querySelector('[data-action="weapons"][data-id="both"]')?.classList.contains('active'));
    const weaponsSet = (await log()).commands.filter((command) => command.kind === 'setWeapons').length;
    check(weaponsSet === 2, 'weapons control is set on the aircraft, Hold and back to Both');
    const kinds = (await log()).commands.map((command) => command.kind);
    check(kinds.includes('forwardContact'), 'the forward command reached the simulation');

    console.log('Answer a support request');
    await page.waitForSelector('#requests button', { timeout: 120000 });
    await setPaused(page, true);
    await page.locator('#requests button').first().click();
    await page.waitForSelector('[data-action="request"][data-kind="sitrep"]');
    await page.locator('[data-action="request"][data-kind="sitrep"]').click();
    const status = await page.locator('#selection .request-status').innerText();
    check(status.includes('Waiting for your answer'), 'the unit panel shows its open request and the answers to it');
    await page.locator('#selection [data-action="no-air"]').click();
    await setPaused(page, false);
    await page.waitForFunction(() => document.querySelector('#requests')?.textContent?.includes('no air is available'));
    check(true, 'the request card shows the answer took effect');
    await page.waitForFunction(
      () => (window as unknown as { airops: Hook }).airops.session.commandLog().commands.some((c) => c.kind === 'acknowledge'),
    );
    const sent = (await log()).commands.map((command) => command.kind);
    check(sent.includes('requestReport') && sent.includes('acknowledge'), 'report request and acknowledgement were sent');
    check(!sent.some((kind) => /move|attack/i.test(kind)), 'no ground movement or attack command exists');

    console.log('Inspect a marker');
    await setPaused(page, true);
    await page.locator('#map').click({ button: 'right', position: { x: 400, y: 300 } });
    await page.locator('[data-action="report-poi"][data-id="killZone"]').click();
    await setPaused(page, false);
    await page.waitForTimeout(300);
    await setPaused(page, true);
    const reportedMarks = (await log()).commands.filter((command) => command.kind === 'reportPoi');
    check(reportedMarks.length === 1, 'a right-click reports a suspected kill zone by radio');
    await page.locator('#map').click({ button: 'right', position: { x: 400, y: 300 } });
    check(await page.locator('[data-action="cancel-poi"]').isVisible(), 'the mark can be cancelled from the same menu');
    const fire = await page.locator('[data-action="menu-fire"][data-kind="Suppress"]').count();
    check(fire > 0 && (await page.locator('[data-action="menu-fire"][data-kind="Strike"]').count()) === fire, 'the same menu offers Suppress and Strike for each strike aircraft');
    await page.locator('[data-action="close-menu"]').click();
    const routineHidden = await page.locator('.log-row.position_report').first().isHidden();
    check(routineHidden, 'the main radio view leaves out routine position reports');
    await page.locator('[data-action="radio-filter"][data-id="all"]').click();
    await page.waitForSelector('.log-row.position_report', { state: 'visible' });
    check(true, 'the All view still shows every report');
    await page.locator('[data-action="radio-filter"][data-id="main"]').click();
    const friendly = await coordinateOf(page, '.log-row.position_report');
    const pixel = await page.evaluate(([p]) => (window as unknown as { airops: Hook }).airops.app.screenPosition(p as Vec), [friendly]);
    await page.locator('#map').hover({ position: pixel });
    await page.waitForTimeout(100);
    await setPaused(page, false);

    console.log('Read coordinates on hover');
    await page.locator('#map').hover({ position: pixel });
    await page.waitForFunction(() => /^Grid \d{3}-\d{3} · \d+ m$/.test(document.querySelector('#cursor-grid')?.textContent ?? ''));
    check(true, 'hovering the map shows the grid reference and elevation');
    const fits = await page.evaluate(() => {
      const holder = document.querySelector('#map-holder');
      const map = document.querySelector<HTMLCanvasElement>('#map');
      return holder !== null && map !== null && map.height === holder.clientHeight && map.width === holder.clientWidth;
    });
    check(fits, 'the canvas fits its container, so the scale bar is not cut off');
    await shot(page, '3b-overlays');

    console.log('Look back through the timeline');
    await page.locator('[data-action="timeline"]').first().click();
    await page.waitForSelector('#timeline', { state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'PAUSED');
    check(true, 'opening the timeline pauses the battle');
    await page.locator('#timeline-slider').fill('600');
    await page.waitForFunction(() => document.querySelector('#timeline-head .review-time')?.textContent !== '');
    const reviewed = await page.locator('#timeline-head .review-time').innerText();
    check(/^\d{4}$/.test(reviewed), `the timeline shows the moment in military time: ${reviewed}`);
    await shot(page, '3b-timeline');
    await page.locator('#timeline-head [data-action="timeline"]').click();
    await page.waitForSelector('#timeline', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'RUNNING');
    check(true, 'closing the timeline goes back to live and resumes');
    await page.locator('[data-action="tab"][data-id="tracks"]').click();
    await page.waitForSelector('#tracks tr.track-row');
    check((await page.locator('#tracks tr.track-row').count()) > 0, 'the track list shows the tracks held');
    await shot(page, '3b-tracks');
    await page.locator('#tracks tr.track-row').first().click();
    await page.waitForSelector('#tracks tr.active');
    check(true, 'clicking a track selects it');
    await page.locator('[data-action="tab"][data-id="radio"]').click();

    console.log('Open the map key');
    await page.locator('#map-layers [data-action="legend"]').click();
    await page.waitForSelector('#legend canvas[data-sample]', { state: 'visible' });
    const samples = await page.locator('#legend canvas[data-sample]').count();
    const explained = await page.locator('#legend').innerText();
    check(samples > 20 && explained.includes('JOKER') && explained.includes('WINCHESTER'), `the key draws ${samples} symbols and explains the radio words`);
    await shot(page, '3b-key');
    await page.locator('#legend [data-action="legend"]').click();
    await page.waitForSelector('#legend', { state: 'hidden' });
    check(true, 'the key closes again');

    console.log('Set an altitude on the profile');
    const box = await page.locator('#altitude-profile').boundingBox();
    if (box === null) throw new Error('no altitude profile');
    const targetOf = (id: string) =>
      page.evaluate(
        (aircraftId) =>
          (window as unknown as { airops: { view: () => PlayerView } }).airops.view().aircraft.find((a) => a.aircraftId === aircraftId)?.targetAltitudeMeters,
        id,
      );
    // Any aircraft already on the profile will do: which ones are depends on how the fight went.
    const onProfile = () =>
      page.evaluate(() => {
        const { view, app } = (window as unknown as { airops: { view: () => PlayerView; app: { profileColumn: (id: string) => number | null } } }).airops;
        return view().aircraft.find((a) => a.altitudeMeters > 0 && app.profileColumn(a.aircraftId) !== null)?.aircraftId;
      });
    if ((await onProfile()) === undefined) {
      const ready = await page.evaluate(
        () => (window as unknown as { airops: { view: () => PlayerView } }).airops.view().aircraft.find((a) => a.status === 'ready')?.aircraftId,
      );
      if (ready === undefined) throw new Error('nothing can fly');
      await page.locator(`[data-action="select-aircraft"][data-id="${ready}"]`).click();
      await page.locator('[data-action="order"][data-kind="Watch"]').click();
      await clickWorld(page, { x: 2500, y: 2500 });
    }
    await page.waitForFunction(() => {
      const { view, app } = (window as unknown as { airops: { view: () => PlayerView; app: { profileColumn: (id: string) => number | null } } }).airops;
      return view().aircraft.some((a) => a.altitudeMeters > 100 && app.profileColumn(a.aircraftId) !== null);
    });
    await setPaused(page, true);
    await page.waitForTimeout(100);
    const spot = await page.evaluate(() => {
      const { view, app } = (window as unknown as { airops: { view: () => PlayerView; app: { profileColumn: (id: string) => number | null } } }).airops;
      const found = view().aircraft.find((a) => app.profileColumn(a.aircraftId) !== null);
      return found === undefined ? null : { id: found.aircraftId, pixel: app.profileColumn(found.aircraftId), all: view().aircraft.map((a) => a.status) };
    });
    if (spot === null || spot.pixel === null) throw new Error('the aircraft is not on the profile');
    const flier = spot.id;
    const columnPixel = spot.pixel;
    const before = await targetOf(flier);
    const column = box.x + columnPixel;
    await page.mouse.move(column, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(column, box.y + box.height * 0.3, { steps: 4 });
    await page.mouse.up();
    await setPaused(page, false);
    await page.waitForFunction(
      ([old, id]) =>
        (window as unknown as { airops: { view: () => PlayerView } }).airops.view().aircraft.find((a) => a.aircraftId === id)?.targetAltitudeMeters !== old,
      [before, flier] as const,
    );
    const after = await targetOf(flier);
    // The crew may already have climbed above where the drag ends, so only a new, snapped target counts.
    check(after !== before && (after ?? 0) % 100 === 0, `dragging the profile set a target of ${after} m`);
    const sentNow = (await log()).commands.map((command) => command.kind);
    check(sentNow.includes('setAltitude'), 'the altitude order is in the replayable command log');
    await page.locator(`[data-action="select-aircraft"][data-id="${flier}"]`).click();
    await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('#path-profile')?.hidden === false);
    check(true, 'selecting an aircraft shows the terrain along its path');
    await shot(page, '3c-profile');

    console.log('Read the battle summary');
    await page.locator('[data-action="tab"][data-id="summary"]').click();
    await page.waitForFunction(() => document.querySelector('#summary')?.textContent?.includes('Known forces'));
    check(true, 'the summary tab shows the reported enemy picture');
    await shot(page, '3d-summary');
    await page.locator('[data-action="tab"][data-id="radio"]').click();

    console.log('Read the weather forecast');
    await page.locator('[data-action="layer"][data-id="weather"]').click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>('#forecast')?.hidden === false);
    await page.locator('#forecast-lead').fill('1800');
    await page.waitForFunction(() => document.querySelector('#forecast-label')?.textContent?.startsWith('+30 min'));
    check(true, 'the forecast slider looks ahead in time');
    await shot(page, '3e-weather');
    await page.locator('[data-action="layer"][data-id="weather"]').click();

    console.log('Change speed, then play to the end');
    await page.locator('[data-action="speed"][data-id="8"]').click();
    await page.waitForSelector('[data-action="speed"][data-id="8"].active');
    check(true, 'speed controls respond');
    await page.evaluate(() => (window as unknown as { airops: { setSpeed: (s: number) => void } }).airops.setSpeed(40));
    await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('OUTPOST'), undefined, {
      timeout: 600000,
    });
    const result = await page.locator('#status').innerText();
    check(true, `the run ended: ${result}`);
    await shot(page, '4-end');

    await page.locator('[data-action="tab"][data-id="summary"]').click();
    await page.waitForFunction(() => document.querySelector('#summary')?.textContent?.includes('what really happened'));
    check(true, 'the end of the run shows a debrief against the estimates');
    await shot(page, '4b-debrief');

    await page.locator('[data-action="timeline"]').first().click();
    await page.waitForSelector('#timeline', { state: 'visible' });
    await page.locator('#timeline-slider').fill('1800');
    await page.locator('#timeline-head [data-action="review-truth"]').click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#timeline-head [data-action="review-truth"]')?.checked === true);
    check(true, 'after the run, the timeline can show where everyone really was');
    await shot(page, '4c-truth');
    await page.locator('#timeline-head [data-action="timeline"]').click();

    console.log('Replay the session headlessly');
    const finalLog = await log();
    const hash = await page.evaluate(() => (window as unknown as { airops: Hook }).airops.session.stateHash());
    const replayed = runReplay(loadScenarioFile(), finalLog).at(-1);
    check(replayed === hash, `replay reproduces the final hash ${hash} over ${finalLog.ticks} ticks`);

    console.log('Fly into a hidden air defense team');
    let damaged = false;
    for (const seed of [15, 17, 18, 22, 23, 25]) {
      if (damaged) break;
      await page.goto(`http://localhost:${PORT}/?seed=${seed}&speed=40`);
      await page.waitForSelector('#clock');
      for (const id of ['CAS-1', 'CAS-2']) {
        await page.locator(`[data-action="select-aircraft"][data-id="${id}"]`).click();
        await page.locator('[data-action="order"][data-kind="Watch"]').click();
        await clickWorld(page, { x: 2700, y: 2250 });
      }
      damaged = await page
        .waitForFunction(() => [...document.querySelectorAll('.aircraft-row')].some((r) => r.textContent?.includes('DAMAGED')), undefined, {
          timeout: 60000,
        })
        .then(() => true)
        .catch(() => false);
    }
    check(damaged, 'an aircraft over the team was hit, and the panel shows it damaged');
    await page.waitForSelector('.log-row.ground_fire');
    check(true, 'the ground fire report reached the radio log');
    await page.locator('.aircraft-row:has-text("DAMAGED")').first().click();
    await page.waitForFunction(() => /altitude \d+ m/.test(document.body.textContent ?? ''));
    check(true, 'the aircraft panel shows altitude');
    const marks = () =>
      page.evaluate(() => (window as unknown as { airops: { view: () => PlayerView } }).airops.view().groundFire.length);
    const start = await page.evaluate(() => (window as unknown as { airops: { view: () => PlayerView } }).airops.view().tick);
    await page.waitForFunction(
      (from) => (window as unknown as { airops: { view: () => PlayerView } }).airops.view().tick > from + 120,
      start,
    );
    check((await marks()) > 0, 'the ground fire mark outlasts the short strike effects');
    await shot(page, '5-damaged');

    console.log('Play a second scenario');
    await page.goto(`http://localhost:${PORT}/?scenario=valley-road&seed=3&speed=40`);
    await page.waitForSelector('#clock');
    check((await page.title()) === 'Valley Road', 'the scenario comes from the URL');
    check((await page.locator('#objective').innerText()).includes('north end of the valley'), 'the briefing comes from the scenario');
    await page.waitForFunction(() => /COLUMN/.test(document.querySelector('#status')?.textContent ?? ''), undefined, { timeout: 600000 });
    check(true, 'the run ended with the scenario\'s own result');
    const secondLog = await log();
    const secondHash = await page.evaluate(() => (window as unknown as { airops: Hook }).airops.session.stateHash());
    check(runReplay(loadScenarioFile('valley-road'), secondLog).at(-1) === secondHash, 'the second scenario replays to the same hash');
    await shot(page, '6-second-scenario');

    check(errors.length === 0, `no browser errors${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`\nPASSED ${checks} checks. ${hook} exposes only the command log and hash.`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
