import type { AircraftPerformance } from '../domain/public/debrief';
import type { Aircraft, WorldTruth } from '../domain/truth/world';
import type { Scenario } from '../scenario/load';
import { distance } from '../domain/public/geometry';
import { strengthInArea } from './outcome';
import { woundedCount } from './wounded';

/** Accounting only: no decisions, random draws or live telemetry depend on these counters. */
export function emptyAircraftRecord(): Aircraft['record'] {
  return {
    airborneSeconds: 0, stationSeconds: 0, landedSeconds: 0, damageIncidents: 0,
    repairSeconds: 0, bombs: 0, gunBursts: 0, flares: 0, illuminationSeconds: 0,
    enemyCasualties: 0, friendlyCasualties: 0, observedSquads: [], firstAirSightings: 0,
    observationSamples: 0, observationErrorMeters: 0, woundedDelivered: 0,
    hospitalSeconds: 0, survivorsDelivered: 0, sorties: [],
  };
}

export function aircraftBeforeTick(truth: WorldTruth) {
  return truth.aircraft.map((a) => ({ status: a.status, damaged: a.damaged, bombs: a.ammunition, guns: a.gunBursts, flares: a.flares }));
}

export function recordAircraftTick(truth: WorldTruth, before: ReturnType<typeof aircraftBeforeTick>, scenario: Scenario, tick: number): void {
  truth.aircraft.forEach((a, index) => {
    const old = before[index];
    if (old === undefined) return;
    const r = a.record;
    if (old.status === 'takeoff' && (a.status === 'enroute' || a.status === 'returning')) r.sorties.push({ departedAt: tick, returnedAt: null });
    if (old.status === 'returning' && a.status === 'turnaround') {
      const sortie = r.sorties.at(-1);
      if (sortie !== undefined) sortie.returnedAt = tick;
    }
    const flying = a.status === 'enroute' || a.status === 'onStation' || a.status === 'returning';
    if (a.landed) r.landedSeconds += 1;
    else if (flying) r.airborneSeconds += 1;
    if (a.status === 'onStation' && !a.landed) r.stationSeconds += 1;
    if (!old.damaged && a.damaged) {
      r.damageIncidents += 1;
      r.repairSeconds += scenario.file.air.models[a.model]?.repairSeconds ?? 0;
    }
    r.bombs += Math.max(0, old.bombs - a.ammunition);
    r.gunBursts += Math.max(0, old.guns - a.gunBursts);
    r.flares += Math.max(0, old.flares - a.flares);
    if (truth.flares.some((f) => f.by === a.id && tick >= f.ignitedAt && tick < f.ignitedAt + f.burnSeconds)) r.illuminationSeconds += 1;
  });
}

export function aircraftPerformance(truth: WorldTruth, scenario: Scenario): readonly AircraftPerformance[] {
  return truth.aircraft.map((a) => {
    const { observedSquads, observationSamples, observationErrorMeters, hospitalSeconds, ...counts } = a.record;
    const model = scenario.file.air.models[a.model];
    return {
      ...counts, aircraftId: a.id, model: model?.displayName ?? a.model, role: a.aircraftType,
      rescueCapable: (model?.seats ?? 0) > 0, flareCapable: (model?.flares ?? 0) > 0,
      enemySquadsSeen: observedSquads.length,
      meanObservationErrorMeters: observationSamples === 0 ? null : Math.round(observationErrorMeters / observationSamples),
      hospitalMinutes: counts.woundedDelivered === 0 ? null : Math.round(hospitalSeconds / counts.woundedDelivered / 60),
      woundedAboard: woundedCount(a.casualtiesAboard),
      survivorsAboard: a.passengers.reduce((sum, id) => {
        const p = truth.platoons[id];
        return sum + (p?.survival?.state === 'aboard' ? p.squads.reduce((n, u) => n + u.personnel, 0) : 0);
      }, 0),
      sorties: counts.sorties.map((s) => ({ ...s })),
    };
  });
}

/** Exact scoring evidence, released only once the session has ended. */
export function missionEvidence(truth: WorldTruth, scenario: Scenario): string[] {
  const m = scenario.file.mission;
  if (m.kind === 'HoldArea') return [
    `${strengthInArea(truth, 'friendly', m)} effective defenders at the objective; ${m.successMinDefenders} required for full success at the deadline.`,
    `Effective means fit personnel in a steady platoon with ammunition. Recovering or withdrawing platoons do not count.`,
    `${strengthInArea(truth, 'enemy', m)} effective attackers at the objective. Capture requires at least ${m.enemyMinEffective} attackers and fewer than ${m.defenderMinEffective} defenders.`,
    `Enemy capture progress: ${truth.captureProgressSeconds} of ${m.holdSeconds} consecutive seconds required.`,
  ];
  if (m.kind === 'ReachArea') {
    const arrived = truth.units.filter((u) => m.unitIds.includes(u.platoonId) && distance(u.position, m.area.center) <= m.area.radius).reduce((sum, u) => sum + u.personnel, 0);
    return [`${arrived} fit personnel reached the destination; ${m.successMinPersonnel} required for full success and ${m.partialMinPersonnel} for partial success.`];
  }
  if (m.kind === 'LocateForce') return [`${Math.round((truth.locatedShare ?? 0) * 100)}% of living enemy squads located at the deadline; ${Math.round(m.successShare * 100)}% required for full success and ${Math.round(m.partialShare * 100)}% for partial success.`, `A qualifying report is at most ${m.freshSeconds} seconds old and within ${m.locateMeters} metres of the squad.`];
  const state = truth.platoons[m.survivorId]?.survival?.state ?? 'unknown';
  return [`Survivor status: ${state}. Full success requires delivery home or linkup with friendly troops; aboard alone is not delivery.`];
}
