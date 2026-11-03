import { describe, expect, it } from 'vitest';
import type { ContactEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import { emptyPlayerKnowledge, updateContact, updateFriendly, type PlayerKnowledge } from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { sectorOf, strengthRange, summarizeBattle, type SummaryConfig } from '../../src/ui/battle-summary';
import { forceRatioText, rangeText, statusText } from '../../src/ui/format';

const objective = { x: 2500, y: 2500 };
const config: SummaryConfig = {
  objective,
  objectiveRadiusMeters: 250,
  areaLabel: 'At the outpost',
  hqEnemyEstimate: 300,
  ratioRadiusMeters: 1000,
  staleSeconds: 600,
  friendlyStrength: { 'F-A': 40 },
  plausibleSpeedMps: 1,
};
const display = {
  freshReportSeconds: 120,
  clusterRadiusMeters: 200,
  reportBlinkSeconds: 20,
  opacityFloor: 0.25,
  fadeSeconds: 900,
  plausibleSpeedMps: 1,
  effectSeconds: 40,
  groundFireMarkSeconds: 900,
  groundFireMergeMeters: 300,
  archiveSeconds: 1200,
  destroyedShowSeconds: 300,
  notFoundShowSeconds: 120,
  friendlySilentSeconds: 600,
  staleSeconds: 120,
  consolidateMaxAgeSeconds: 120,
};

const report = (id: string, source: string, x: number, y: number, observedAt = 100, min = 15, max = 50): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId: source, observedAt },
  identification: 'hostile',
  position: { center: { x, y }, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt },
  strength: { kind: 'range', min, max },
  kind: 'infantry',
  activity: 'moving',
  confidence: 'medium',
  observedWeapons: [],
});

const summary = (player: PlayerKnowledge, tick = 110) => summarizeBattle(project(player, [], tick, display), config);

describe('battle summary', () => {
  it('counts overlapping reports separately at the high end and once at the low end', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2000, 1800), 100, false);
    updateContact(player, report('C-2', 'F-B', 2020, 1810), 100, false);
    const result = summary(player);
    expect(result.known).toEqual({ low: 15, high: 65 });
    expect(result.groups).toBe(1);
    expect(result.unconfirmed).toBe(1);
  });

  it('narrows the range once recon consolidates the reports', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2000, 1800), 100, false);
    updateContact(player, report('C-2', 'F-B', 2020, 1810), 100, false);
    updateContact(player, report('C-3', 'RECON-1', 2010, 1805, 105, 20, 30), 105, true);
    const result = summary(player);
    expect(result.known).toEqual({ low: 20, high: 25 });
    expect(result.unconfirmed).toBe(0);
  });

  it('adds up separate groups in both ends, with what is left over as unlocated', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2500, 1500), 100, false);
    updateContact(player, report('C-2', 'F-B', 3500, 2500), 100, false);
    const result = summary(player);
    expect(result.known).toEqual({ low: 30, high: 65 });
    expect(result.unlocated).toEqual({ low: 235, high: 270 });
  });

  it('breaks forces down by sector and warns when one has gone stale', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2500, 1500, 100), 100, false);
    updateContact(player, report('C-2', 'F-B', 3500, 2500, 900), 900, false);
    const result = summary(player, 900);
    expect(result.sectors.map((s) => [s.name, s.stale])).toEqual([['North', true], ['East', false]]);
  });

  it('leaves destroyed and not-found reports out of the known total', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2500, 1500), 100, false);
    const entry = player.contacts['F-A/C-1'];
    if (entry === undefined) throw new Error('missing');
    player.contacts['F-A/C-1'] = { ...entry, status: 'destroyed', statusAt: 105 };
    expect(summary(player).known).toEqual({ low: 0, high: 0 });
  });

  it('shows losses as a range around the crews\' estimates', () => {
    const player = emptyPlayerKnowledge();
    player.estimatedLosses = 100;
    player.confirmedDestroyed = 2;
    expect(summary(player)).toMatchObject({ losses: { low: 70, high: 130 }, confirmedDestroyed: 2 });
  });

  it('uses the starting strength until a unit has reported, then its report', () => {
    const player = emptyPlayerKnowledge();
    updateFriendly(player, 'F-A', { center: objective, sigmaMeters: 40, headingRad: null, speedMps: null, observedAt: 100 }, 'self-report', 100, 120);
    expect(summary(player).friendlies[0]).toMatchObject({ personnel: 40, fromReport: false });
    player.statusReports['F-A'] = { personnel: 22, ammunitionFraction: 0.5, status: 'holding', receivedAt: 100 };
    expect(summary(player)).toMatchObject({ defenders: 22 });
    expect(summary(player).friendlies[0]).toMatchObject({ personnel: 22, ammunitionPercent: 50, fromReport: true });
  });

  it('measures the threat near the outpost only', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2500, 2000), 100, false);
    updateContact(player, report('C-2', 'F-B', 2500, 500), 100, false);
    expect(summary(player).threatened).toEqual({ low: 15, high: 33 });
  });

  it('stays believable with many overlapping reports of big units', () => {
    const player = emptyPlayerKnowledge();
    for (let i = 0; i < 6; i += 1) {
      updateContact(player, report(`C-${i}`, `F-${i}`, 2000 + i * 10, 1800, 100, 51, 150), 100, false);
    }
    expect(summary(player).known.high).toBeLessThan(620);
  });

  it('reports one air threat once, however many tracks saw it', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, { ...report('C-1', 'F-A', 2500, 1500), observedWeapons: ['MANPADS'] }, 100, false);
    updateContact(player, { ...report('C-2', 'F-B', 2520, 1500), observedWeapons: ['MANPADS'] }, 100, false);
    expect(summary(player).airThreats).toEqual([{ sector: 'North', weapons: 'MANPADS' }]);
  });

  it('is built from knowledge alone: the same view gives the same summary', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, report('C-1', 'F-A', 2500, 2000), 100, false);
    const copy = structuredClone(player);
    expect(summary(copy)).toEqual(summary(player));
  });
});

describe('summary wording', () => {
  it('names the sector, with north as negative y', () => {
    expect(sectorOf({ x: 2500, y: 1000 }, objective)).toBe('North');
    expect(sectorOf({ x: 4000, y: 2600 }, objective)).toBe('East');
    expect(sectorOf({ x: 2500, y: 4000 }, objective)).toBe('South');
    expect(sectorOf({ x: 1000, y: 2500 }, objective)).toBe('West');
  });

  it('writes ranges and force ratios', () => {
    expect(rangeText({ low: 5, high: 5 })).toBe('5');
    expect(rangeText({ low: 120, high: 180 })).toBe('120–180');
    expect(forceRatioText({ low: 120, high: 180 }, 60)).toBe('2–3 : 1');
    expect(forceRatioText({ low: 120, high: 180 }, 0)).toBeNull();
  });

  it('describes a status only when there is one', () => {
    expect(statusText('active', 0)).toBeNull();
    expect(statusText('hit', 8)).toContain('about 8 casualties');
    expect(statusText('destroyed', 0)).toBe('Reported destroyed');
  });
});

describe('summary with an empty strength range', () => {
  it('handles no reports', () => {
    expect(strengthRange([], 1)).toEqual({ low: 0, high: 0, clusters: 0 });
  });
});
