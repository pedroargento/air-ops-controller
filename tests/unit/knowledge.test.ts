import { describe, expect, it } from 'vitest';
import type { ContactEstimate, PositionEstimate } from '../../src/domain/public/estimates';
import type { ContactId } from '../../src/domain/public/ground';
import type { MessageId, RadioMessage } from '../../src/domain/public/radio';
import {
  emptyPlayerKnowledge,
  receiveByPlayer,
  updateContact,
  updateFriendly,
} from '../../src/knowledge/player-knowledge';
import { project } from '../../src/knowledge/player-view';
import { markerOpacity, reachableRegion, regionOpacity } from '../../src/knowledge/reachability';

const display = {
  opacityFloor: 0.25,
  fadeSeconds: 900,
  plausibleSpeedMps: 1,
  coneBaseHalfAngleRad: 0.35,
  coneWidenRadPerSecond: 0.002,
  regionMaxRadiusMeters: 700,
  regionFadeSeconds: 480,
  effectSeconds: 40,
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
    receiveByPlayer(player, { ...meta, kind: 'SUPPORT_REQUEST', ownPosition: position() }, 120);
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
    updateContact(player, contact('C-2', 'RECON-1', 100), 100, true);
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

  it('keeps a marker selectable at the opacity floor when very old', () => {
    const player = emptyPlayerKnowledge();
    updateContact(player, contact('C-1', 'F-A', 0), 20, false);
    expect(project(player, [], 100000, display).contacts[0]?.opacity).toBe(0.25);
  });
});
