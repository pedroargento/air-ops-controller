import type { AircraftPerformance, CasualtyOutcome, Debrief } from '../domain/public/debrief';
import { clock, duration } from './format';

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const metric = (label: string, value: string | number): string => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;

function casualties(label: string, c: CasualtyOutcome): string {
  return `<tr><th scope="row">${label}</th><td>${c.killed}</td><td>${c.wounded}</td><td>${c.diedOfWounds}</td><td>${c.evacuated}</td><td>${c.aboard}</td><td>${c.waiting}</td></tr>`;
}

function aircraftCard(a: AircraftPerformance): string {
  const strike = a.role === 'cas'
    ? metric('Bombs released', a.bombs) + metric('Gun bursts fired', a.gunBursts) + metric('Enemy casualties from strikes', a.enemyCasualties) + metric('Friendly casualties from strikes', a.friendlyCasualties)
    : '';
  const rescue = a.rescueCapable
    ? metric('Survivors delivered', a.survivorsDelivered) + metric('Survivors still aboard', a.survivorsAboard) + metric('Wounded delivered', a.woundedDelivered) + metric('Wounded still aboard', a.woundedAboard) + metric('Wound to hospital, average', a.hospitalMinutes === null ? 'No deliveries' : `${a.hospitalMinutes} min`) + metric('Time landed at pickups', duration(a.landedSeconds))
    : '';
  const flares = a.flareCapable
    ? metric('Flares dropped', a.flares) + metric('Time with a flare burning', duration(a.illuminationSeconds)) : '';
  const sorties = a.sorties.map((s, i) => `<li>Sortie ${i + 1}: departed ${clock(s.departedAt)} · ${s.returnedAt === null ? 'still away at mission end' : `returned ${clock(s.returnedAt)}`}</li>`).join('');
  return `<details class="aircraft-report"><summary><strong>${escapeHtml(a.aircraftId)}</strong> · ${escapeHtml(a.model)} · ${a.sorties.length} ${a.sorties.length === 1 ? 'sortie' : 'sorties'} · ${duration(a.airborneSeconds)} airborne</summary>` +
    `<dl class="report-metrics">${metric('Time on station, airborne', duration(a.stationSeconds))}${metric('Damage incidents', a.damageIncidents)}${metric('Repair time incurred', duration(a.repairSeconds))}${strike}` +
    `${metric('Distinct enemy squads observed', a.enemySquadsSeen)}${metric('First air sightings', a.firstAirSightings)}${metric('Position error, average', a.meanObservationErrorMeters === null ? 'No enemy observations' : `${a.meanObservationErrorMeters} m`)}${rescue}${flares}</dl>` +
    (sorties === '' ? '<p>No sorties flown.</p>' : `<h4>Sortie history</h4><ol>${sorties}</ol>`) + '</details>';
}

/** Receives only the completed report; this module has no access to simulation truth. */
export function missionReportHtml(report: Debrief): string {
  const m = report.mission;
  const enemyLost = report.enemyStart - report.enemyLeft;
  const sources = report.sources.map((s) => `<tr><th scope="row">${escapeHtml(s.sourceId)}</th><td>${s.reliability}</td><td>${s.reports}</td><td>${s.meanErrorMeters} m</td><td>${s.misidentified}</td><td>${s.claimed}</td></tr>`).join('');
  return `<header class="report-head"><div><p>AFTER ACTION · ${duration(m.elapsedSeconds)}</p><h1 id="mission-report-title">Mission report</h1><h2>${escapeHtml(m.name)}</h2></div><button data-action="close-report" autofocus>Back to map</button></header>` +
    `<section><h2>${escapeHtml(m.result)}</h2><p>${escapeHtml(m.objective)}</p><ul>${m.evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></section>` +
    `<section><h2>People</h2><p>Friendly fit personnel: ${report.friendlyLeft} of ${report.friendlyStart} at start. Enemy fit personnel: ${report.enemyLeft} of ${report.enemyStart}.</p>` +
    `<div class="report-table"><table><caption>Casualties and evacuation at mission end</caption><thead><tr><th>Side</th><th>Killed</th><th>Wounded</th><th>Died of wounds</th><th>Evacuated</th><th>Aboard</th><th>Waiting</th></tr></thead><tbody>${casualties('Friendly', report.casualties.friendly)}${casualties('Enemy', report.casualties.enemy)}</tbody></table></div>` +
    `<p class="hint-quiet">Died of wounds is included in wounded, not an additional casualty. Evacuated, aboard and waiting describe the wounded. Fit personnel excludes all casualties.</p>` +
    `<p>${report.friendlyFireCasualties} friendly casualties caused by your strikes. ${report.casualties.friendly.hospitalMinutes === null ? 'No wounded reached hospital.' : `Wound to hospital averaged ${report.casualties.friendly.hospitalMinutes} minutes for those delivered.`}</p>` +
    `<p>Friendly platoons lost: ${report.friendlyDestroyed}. Enemy platoons destroyed: ${report.enemyDestroyed}; broken but surviving: ${report.enemyBroken}.</p></section>` +
    `<section><h2>Aircraft performance</h2><p>Contributions by aircraft. Expand a row for its results and sortie history.</p>${report.aircraft.map(aircraftCard).join('')}` +
    `<p class="hint-quiet">Strike casualties include killed and wounded, not kills alone. First air sightings credit the first aircraft to observe each enemy squad; repeat sightings do not add discoveries. Observation error averages enemy sighting samples. Illumination time counts overlapping flares once per aircraft. These measures do not estimate lives saved or rank aircraft.</p></section>` +
    `<section><h2>Intelligence: claims and reality</h2><p>Aircrews claimed ${report.airClaims} enemy casualties; ground units claimed ${report.groundClaims}. Actual enemy losses from all causes: ${enemyLost}. Claims can overlap and are not added together.</p>` +
    (report.locatedShare === null ? '' : `<p>Your final picture located ${Math.round(report.locatedShare * 100)}% of living enemy squads.</p>`) +
    (sources === '' ? '<p>No contact reports to assess.</p>' : `<details><summary>Source accuracy</summary><div class="report-table"><table><thead><tr><th>Source</th><th>Reliability</th><th>Reports</th><th>Mean error</th><th>Wrong side</th><th>Claimed</th></tr></thead><tbody>${sources}</tbody></table></div><p>A is completely reliable; E is unreliable. Wrong side counts friendlies reported as hostile.</p></details>`) +
    `</section><footer><button data-action="export-report">Download report</button> <button data-action="close-report">Back to map</button><p class="hint-quiet">Use the timeline to compare what you knew with what really happened.</p></footer>`;
}
