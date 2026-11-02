import { describe, expect, it } from 'vitest';
import type { ContactEstimate, PositionEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import type { MessageId, RadioMessage } from '../../src/domain/public/radio';
import {
  emptyPlayerKnowledge,
  receiveByPlayer,
  recordStrike,
  reviewContacts,
  updateContact,
  updateFriendly,
} from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { markerOpacity, reachableRegion, regionOpacity } from '../../src/knowledge/reachability';

const display = {
  freshReportSeconds: 120,
  clusterRadiusMeters: 200,
  reportBlinkSeconds: 20,
  opacityFloor: 0.25,
  fadeSeconds: 900,
  plausibleSpeedMps: 1,
  coneBaseHalfAngleRad: 0.35,
  coneWidenRadPerSecond: 0.002,
  regionMaxRadiusMeters: 700,
  regionFadeSeconds: 480,
  effectSeconds: 40,
  groundFireMarkSeconds: 900,
  groundFireMergeMeters: 300,
  archiveSeconds: 1200,
  destroyedShowSeconds: 300,
  notFoundShowSeconds: 120,
  friendlySilentSeconds: 600,
  consolidateMaxAgeSeconds: 120,
};

const position = (overrides: Partial<PositionEstimate> = {}): PositionEstimate => ({
  center: { x: 100, y: 100 },
  sigmaMeters: 40,
  headingRad: null,
  speedMps: null,
  observedAt: 0,
  ...overrides,
});

const contact = (id: string, sourceId: string, observedAt: number, x = 100): ContactEstimate => ({
  contactId: id as ContactId,
  provenance: { sourceId, observedAt },
  identification: 'hostile',
  position: position({ center: { x, y: 100 }, observedAt }),
  strength: { kind: 'range', min: 15, max: 50 },
  kind: 'infantry',
  activity: 'moving',
  confidence: 'medium',
  observedWeapons: [],
});

const meta = { id: 'M-1' as MessageId, senderId: 'F-A', observedAt: 0, sentAt: 10, receivedAt: 30 };

describe('marker aging', () => {
  it('fades with age but never below the floor', () => {
    expect(markerOpacity(0, display)).toBe(1);
    expect(markerOpacity(450, display)).toBeCloseTo(0.5);
    expect(markerOpacity(100000, display)).toBe(0.25);
  });
});

describe('reachable region', () => {
  it('is a growing circle when movement is unknown', () => {
    const near = reachableRegion(position(), 60, display);
    const far = reachableRegion(position(), 600, display);
    expect(near).toEqual({ kind: 'circle', center: { x: 100, y: 100 }, radiusMeters: 100 });
    expect(far).toMatchObject({ kind: 'circle', radiusMeters: 640 });
  });

  it('is a sector along the heading that lengthens and widens with age', () => {
    const moving = position({ headingRad: 1, speedMps: 2 });
    const near = reachableRegion(moving, 60, display);
    const far = reachableRegion(moving, 600, display);
    if (near.kind !== 'sector' || far.kind !== 'sector') throw new Error('expected sectors');
    expect(near.origin).toEqual(moving.center);
    expect(near.headingRad).toBe(1);
    expect(far.radiusMeters).toBeGreaterThan(near.radiusMeters);
    expect(far.halfAngleRad).toBeGreaterThan(near.halfAngleRad);
  });

  it('stops growing at the configured radius', () => {
    expect(reachableRegion(position(), 100000, display)).toMatchObject({ radiusMeters: 700 });
    expect(reachableRegion(position({ headingRad: 1, speedMps: 3 }), 100000, display)).toMatchObject({ radiusMeters: 700 });
  });

  it('fades out with age while the marker keeps its floor', () => {
    expect(regionOpacity(0, display)).toBe(1);
    expect(regionOpacity(240, display)).toBeCloseTo(0.5);
    expect(regionOpacity(480, display)).toBe(0);
    expect(regionOpacity(100000, display)).toBe(0);
    expect(markerOpacity(100000, display)).toBe(0.25);
  });

  it('stays anchored at the reported point however old it gets', () => {
    expect(reachableRegion(position(), 5000, display)).toMatchObject({ center: { x: 100, y: 100 } });
  });
});

describe('player knowledge', () => {
  it('updates from a delivered report and keeps send and receive times', () => {
    const player = emptyPlayerKnowledge();
    const message: RadioMessage = { ...meta, kind: 'POSITION_REPORT', position: position() };
    receiveByPlayer(player, message, 120);
    expect(player.friendlies['F-A']).toMatchObject({ source: 'self-report', receivedAt: 30 });
    expect(player.log).toEqual([message]);
  });

  it('a stale report does not become fresh on arrival', () => {
    const player = emptyPlayerKnowledge();
    receiveByPlayer(player, { ...meta, kind: 'POSITION_REPORT', position: position({ observedAt: 5 }) }, 120);
    const view = project(player, [], 500, display);
    expect(view.friendlies[0]?.ageSeconds).toBe(495);
  });

  it('flags TICs and records pending support requests without launching anything', () => {
    const player = emptyPlayerKnowledge();
    receiveByPlayer(player, { ...meta, kind: 'TIC', ownPosition: position(), contact: contact('C-1', 'F-A', 0) }, 120);
    receiveByPlayer(player, { ...meta, kind: 'SUPPORT_REQUEST', ownPosition: position(), dangerClose: false, wants: 'both', target: null }, 120);
    expect(player.ticFlags['F-A']).toBeDefined();
    expect(player.supportRequests['F-A']?.acknowledged).toBe(false);
    expect(Object.keys(player.contacts)).toEqual(['F-A/C-1']);
  });

  it('supersedes within a source track but does not merge across sources', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 10), 20, false);
    updateContact(player, contact('C-1', 'F-A', 30, 200), 40, false);
    updateContact(player, contact('C-1', 'F-A', 5, 999), 50, false);
    updateContact(player, contact('C-7', 'F-N', 30, 210), 40, false);
    expect(Object.keys(player.contacts).sort()).toEqual(['F-A/C-1', 'F-N/C-7']);
    expect(player.contacts['F-A/C-1']?.contact.position.center.x).toBe(200);
  });

  it('a newer self-report usually updates the marker', () => {
    const player = emptyPlayerKnowledge();
    updateFriendly(player, 'F-A', position({ observedAt: 0 }), 'self-report', 10, 120);
    updateFriendly(player, 'F-A', position({ observedAt: 60, center: { x: 300, y: 300 } }), 'self-report', 70, 120);
    expect(player.friendlies['F-A']?.position.center.x).toBe(300);
    expect(player.discrepancies).toHaveLength(0);
  });

  it('keeps a recent, more reliable aircraft fix and records the disagreement', () => {
    const player = emptyPlayerKnowledge();
    const fix = position({ observedAt: 100, sigmaMeters: 15 });
    const report = position({ observedAt: 130, center: { x: 400, y: 400 } });
    updateFriendly(player, 'F-A', fix, 'aircraft', 100, 120);
    updateFriendly(player, 'F-A', report, 'self-report', 140, 120);
    expect(player.friendlies['F-A']?.position).toEqual(fix);
    expect(player.discrepancies).toEqual([{ unitId: 'F-A', kept: fix, conflicting: report, recordedAt: 140 }]);
  });

  it('accepts the self-report again once the aircraft fix is old', () => {
    const player = emptyPlayerKnowledge();
    updateFriendly(player, 'F-A', position({ observedAt: 100, sigmaMeters: 15 }), 'aircraft', 100, 120);
    updateFriendly(player, 'F-A', position({ observedAt: 400, center: { x: 400, y: 400 } }), 'self-report', 410, 120);
    expect(player.friendlies['F-A']?.source).toBe('self-report');
  });
});

describe('closing contacts', () => {
  const review = { plausibleSpeedMps: 1, notFoundMinAgeSeconds: 60, notFoundLookSeconds: 60, notFoundCoverage: 0.7, consolidateMaxAgeSeconds: 120 };
  const sensors = [{ position: { x: 100, y: 100 }, radiusMeters: 1000 }];
  const hit = { estimatedCasualties: 8, destroyed: false };
  const kill = { estimatedCasualties: 12, destroyed: true };

  function looked(from: number, scans: number, player = emptyPlayerKnowledge()) {
    updateContact(player, contact('C-1', 'F-A', 0), 10, false);
    for (let i = 0; i < scans; i += 1) reviewContacts(player, sensors, review, 5, from + i * 5);
    return player.contacts['F-A/C-1'];
  }

  it('closes a report after a clear look finds nothing', () => {
    expect(looked(100, 13)).toMatchObject({ status: 'not-found' });
  });

  it('needs enough looking, by an aircraft actually covering the spot', () => {
    expect(looked(100, 3)?.status).toBe('active');
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 0), 10, false);
    for (let i = 0; i < 20; i += 1) reviewContacts(player, [{ position: { x: 5000, y: 0 }, radiusMeters: 1000 }], review, 5, 100 + i * 5);
    expect(player.contacts['F-A/C-1']?.status).toBe('active');
  });

  it('leaves a report alone if an aircraft has a fresh sighting that could be it', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 0), 10, false);
    updateContact(player, contact('C-9', 'RECON-1', 190, 130), 190, true);
    for (let i = 0; i < 13; i += 1) reviewContacts(player, sensors, review, 5, 200 + i * 5);
    expect(player.contacts['F-A/C-1']?.status).toBe('active');
  });

  it('a new sighting reopens a closed report; an older one does not', () => {
    const player = emptyPlayerKnowledge();
    expect(looked(100, 13, player)?.status).toBe('not-found');
    updateContact(player, contact('C-1', 'F-A', 150), 160, false);
    expect(player.contacts['F-A/C-1']?.status).toBe('not-found');
    updateContact(player, contact('C-1', 'F-A', 500), 510, false);
    expect(player.contacts['F-A/C-1']?.status).toBe('active');
  });

  it('a strike records damage, which stays through later sightings', () => {
    const player = emptyPlayerKnowledge();
    const seen = contact('C-1', 'CAS-1', 100);
    updateContact(player, seen, 100, true);
    recordStrike(player, seen, hit, 1, 110);
    updateContact(player, contact('C-1', 'CAS-1', 120), 120, true);
    expect(player.contacts['CAS-1/C-1']).toMatchObject({ status: 'hit', estimatedLosses: 8 });
    expect(player.estimatedLosses).toBe(8);
  });

  it('a kill closes the reports likely to be the same unit, and only those', () => {
    const player = emptyPlayerKnowledge();
    const seen = contact('C-1', 'CAS-1', 100);
    updateContact(player, seen, 100, true);
    updateContact(player, contact('C-2', 'F-A', 90, 120), 100, false);
    updateContact(player, contact('C-3', 'F-B', 95, 4000), 100, false);
    recordStrike(player, seen, kill, 1, 110);
    expect(player.contacts['F-A/C-2']?.status).toBe('destroyed');
    expect(player.contacts['F-B/C-3']?.status).toBe('active');
    expect(player.confirmedDestroyed).toBe(1);
  });

  it('old and closed reports leave the map but are counted as archived', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 0), 10, false);
    expect(project(player, [], 1000, display).contacts).toHaveLength(1);
    const later = project(player, [], 1300, display);
    expect(later.contacts).toHaveLength(0);
    expect(later.archivedContacts).toBe(1);
  });

  it('flags a friendly unit that has gone silent, without calling it lost', () => {
    const player = emptyPlayerKnowledge();
    updateFriendly(player, 'F-A', position({ observedAt: 0 }), 'self-report', 0, 120);
    expect(project(player, [], 300, display).friendlies[0]?.silent).toBe(false);
    expect(project(player, [], 600, display).friendlies[0]).toMatchObject({ silent: true, unitId: 'F-A' });
  });

  it('keeps a unit\'s last status report for the summary', () => {
    const player = emptyPlayerKnowledge();
    receiveByPlayer(player, { ...meta, kind: 'SITREP', ownPosition: position(), personnel: 22, ammunitionFraction: 0.5, status: 'holding' }, 120);
    expect(project(player, [], 100, display).friendlies[0]?.statusReport).toMatchObject({ personnel: 22, ammunitionFraction: 0.5 });
  });
});

describe('consolidation', () => {
  it('a fresh aircraft sighting absorbs older reports that could be the same unit', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 80, 120), 90, false);
    updateContact(player, contact('C-2', 'F-B', 85, 110), 90, false);
    updateContact(player, contact('C-3', 'RECON-1', 100), 100, true);
    const { contacts } = project(player, [], 105, display);
    expect(contacts.map((m) => m.key)).toEqual(['RECON-1/C-3']);
    expect(contacts[0]?.members.map((m) => m.key).sort()).toEqual(['F-A/C-1', 'F-B/C-2']);
  });

  it('never deletes anything: stored reports stay as they were', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 80, 120), 90, false);
    updateContact(player, contact('C-3', 'RECON-1', 100), 100, true);
    project(player, [], 105, display);
    expect(Object.keys(player.contacts).sort()).toEqual(['F-A/C-1', 'RECON-1/C-3']);
  });

  it('does not merge ground reports with each other, or anything on age alone', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 80, 120), 90, false);
    updateContact(player, contact('C-2', 'F-B', 85, 110), 90, false);
    expect(project(player, [], 105, display).contacts).toHaveLength(2);
  });

  it('needs a fresh, confident sighting', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 80, 120), 90, false);
    updateContact(player, { ...contact('C-3', 'RECON-1', 100), confidence: 'low' }, 100, true);
    expect(project(player, [], 105, display).contacts).toHaveLength(2);
  });

  it('keeps reports apart when the estimates can\'t be one unit', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 80, 3000), 90, false);
    updateContact(player, { ...contact('C-2', 'F-B', 80, 120), strength: { kind: 'range', min: 100, max: 150 } }, 90, false);
    updateContact(player, contact('C-3', 'RECON-1', 100), 100, true);
    expect(project(player, [], 105, display).contacts).toHaveLength(3);
  });

  it('carries over a weapon any report saw, without changing the stored report', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, { ...contact('C-1', 'F-A', 80, 120), observedWeapons: ['MANPADS'] }, 90, false);
    updateContact(player, contact('C-3', 'RECON-1', 100), 100, true);
    expect(project(player, [], 105, display).contacts[0]?.contact.observedWeapons).toEqual(['MANPADS']);
    expect(player.contacts['RECON-1/C-3']?.contact.observedWeapons).toEqual([]);
  });
});

describe('PlayerView', () => {
  it('gives the same output for the same knowledge, telemetry and time', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 10), 20, false);
    const a = project(player, [], 100, display);
    const b = project(structuredClone(player), [], 100, display);
    expect(b).toEqual(a);
  });

  it('marks contacts seen fighting, only while the sighting is recent', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, { ...contact('C-1', 'RECON-1', 100), activity: 'engaging' }, 100, true);
    updateContact(player, contact('C-2', 'RECON-1', 100, 3000), 100, true);
    const now = project(player, [], 110, display).contacts;
    expect(now.map((m) => m.engaging)).toEqual([true, false]);
    expect(project(player, [], 200, display).contacts[0]?.engaging).toBe(false);
  });

  it('marks friendly units as fighting from a TIC or an aircraft sighting', () => {
    const player = emptyPlayerKnowledge();
    updateFriendly(player, 'F-A', position({ observedAt: 100 }), 'self-report', 100, 120);
    expect(project(player, [], 105, display).friendlies[0]?.engaging).toBe(false);
    player.friendlyEngagedAt['F-A'] = 100;
    expect(project(player, [], 105, display).friendlies[0]?.engaging).toBe(true);
    expect(project(player, [], 200, display).friendlies[0]?.engaging).toBe(false);
  });

  it('shows a strike effect only briefly', () => {
    const player = emptyPlayerKnowledge();
    player.strikes.push({ aircraftId: 'CAS-1', position: { x: 1, y: 2 }, tick: 100, effectObserved: true });
    expect(project(player, [], 110, display).strikes).toEqual([
      { aircraftId: 'CAS-1', position: { x: 1, y: 2 }, ageSeconds: 10, effectObserved: true },
    ]);
    expect(project(player, [], 200, display).strikes).toEqual([]);
  });

  it('keeps a ground fire mark for its full time, fading, then drops it', () => {
    const player = emptyPlayerKnowledge();
    player.groundFire.push({ aircraftId: 'CAS-1', position: { x: 1, y: 2 }, tick: 100, hit: true, weapon: 'MANPADS' });
    expect(project(player, [], 110, display).groundFire[0]).toMatchObject({ weapon: 'MANPADS', ageSeconds: 10 });
    const later = project(player, [], 550, display).groundFire[0];
    expect(later?.opacity).toBeCloseTo(0.5);
    expect(project(player, [], 1001, display).groundFire).toEqual([]);
  });

  it('merges ground fire in one place, keeping the newest time and anything learned', () => {
    const player = emptyPlayerKnowledge();
    const mark = (x: number, tick: number, hit: boolean, weapon: 'MANPADS' | null) =>
      player.groundFire.push({ aircraftId: 'CAS-1', position: { x, y: 0 }, tick, hit, weapon });
    mark(0, 100, true, 'MANPADS');
    mark(2000, 150, false, null);
    mark(100, 200, false, null);
    const marks = project(player, [], 300, display).groundFire;
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({ position: { x: 100, y: 0 }, ageSeconds: 100, hit: true, weapon: 'MANPADS' });
  });

  it('keeps an aged marker selectable at the opacity floor until it is archived', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 0), 20, false);
    expect(project(player, [], 1100, display).contacts[0]?.opacity).toBe(0.25);
  });
});

describe('clusters', () => {
  const held = (...contacts: readonly ContactEstimate[]) => {
    const player = emptyPlayerKnowledge();
    for (const entry of contacts) updateContact(player, entry, 0, true);
    return project(player, [], 10, display);
  };

  it('rings nearby hostile reports, with a count and combined strength', () => {
    const view = held(contact('C-1', 'CAS-1', 0, 100), contact('C-2', 'RECON-1', 0, 250));
    expect(view.clusters).toHaveLength(1);
    expect(view.clusters[0]?.reports).toBe(2);
    expect(view.clusters[0]?.strength).toEqual({ kind: 'range', min: 51, max: 150 });
  });

  it('leaves a lone report alone: one large report never becomes invented squads', () => {
    expect(held(contact('C-1', 'CAS-1', 0)).clusters).toEqual([]);
  });

  it('keeps distant reports apart', () => {
    expect(held(contact('C-1', 'CAS-1', 0, 100), contact('C-2', 'CAS-1', 0, 2000)).clusters).toEqual([]);
  });

  it('holds nothing about organization', () => {
    const [cluster] = held(contact('C-1', 'CAS-1', 0, 100), contact('C-2', 'RECON-1', 0, 250)).clusters;
    expect(Object.keys(cluster ?? {}).sort()).toEqual(['center', 'radiusMeters', 'reports', 'strength']);
  });
});

describe('who is reporting', () => {
  const position = { center: { x: 0, y: 0 }, sigmaMeters: 30, headingRad: null, speedMps: null, observedAt: 0 };
  const said = (senderId: string, receivedAt: number, kind: 'TIC' | 'POSITION_REPORT'): RadioMessage =>
    kind === 'TIC'
      ? { ...meta, senderId, receivedAt, kind, ownPosition: position, contact: null }
      : { ...meta, senderId, receivedAt, kind, position };

  it('names senders just heard, and forgets them soon after', () => {
    const player = emptyPlayerKnowledge();
    player.log.push(said('F-A', 100, 'POSITION_REPORT'));
    expect(project(player, [], 110, display).reporting).toEqual([{ senderId: 'F-A', level: 'routine' }]);
    expect(project(player, [], 130, display).reporting).toEqual([]);
  });

  it('keeps the urgent level when a routine message follows it', () => {
    const player = emptyPlayerKnowledge();
    player.log.push(said('F-A', 100, 'POSITION_REPORT'), said('F-A', 104, 'TIC'), said('F-A', 106, 'POSITION_REPORT'));
    expect(project(player, [], 110, display).reporting).toEqual([{ senderId: 'F-A', level: 'urgent' }]);
  });
});
