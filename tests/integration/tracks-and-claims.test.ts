import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../../src/cli/load-scenario';
import { GameSession } from '../../src/game/session';
import { reliabilityLetter } from '../../src/sim/scorecard';

const scenario = loadScenarioFile('outpost-under-pressure');

function fought(ticks: number): GameSession {
  const session = new GameSession(scenario, 3);
  for (let i = 0; i < ticks && session.outcome === 'running'; i += 1) session.advance();
  return session;
}

describe('casualty claims and tracks', () => {
  const session = fought(4500);
  const view = session.view();

  it('ground units claim casualties they caused, and the map adds them to the track', () => {
    const claimed = view.contacts.filter((marker) => marker.estimatedLosses > 0);
    expect(claimed.length).toBeGreaterThan(0);
  });

  it('puts every report on a track, with fewer markers than reports', () => {
    const reports = view.contacts.reduce((sum, marker) => sum + 1 + marker.members.length, 0);
    expect(view.contacts.every((marker) => marker.trackNumber !== null)).toBe(true);
    expect(view.contacts.length).toBeLessThan(reports);
  });
});

describe('debrief', () => {
  it('compares claims with the truth and rates each source', () => {
    const session = new GameSession(scenario, 3);
    while (session.outcome === 'running') session.advance();
    const debrief = session.debrief();
    expect(debrief?.groundClaims).toBeGreaterThan(0);
    expect(debrief?.sources.length).toBeGreaterThan(0);
    expect(debrief?.sources.every((source) => /^[A-E]$/.test(source.reliability))).toBe(true);
  });

  it('rates by accuracy, and any friendly reported as hostile as unreliable', () => {
    expect(reliabilityLetter(40, 0)).toBe('A');
    expect(reliabilityLetter(200, 0)).toBe('C');
    expect(reliabilityLetter(900, 0)).toBe('D');
    expect(reliabilityLetter(40, 1)).toBe('E');
  });
});
