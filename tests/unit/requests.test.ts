import { describe, expect, it } from 'vitest';
import type { AircraftTelemetryEntry } from '../../src/domain/public/air';
import { requestStatus, showRequest, supportOptions, type SupportRequestView } from '../../src/ui/requests';

const clock = (tick: number): string => `t${tick}`;

const request = (overrides: Partial<SupportRequestView> = {}): SupportRequestView =>
  ({
    unitId: 'F-A',
    position: { center: { x: 0, y: 0 }, sigmaMeters: 20, headingRad: null, speedMps: null, observedAt: 0 },
    acknowledged: false,
    dangerClose: false,
    wants: 'both',
    target: null,
    targetStrength: null,
    marked: false,
    ageSeconds: 30,
    answer: null,
    dangerCloseUntil: null,
    ...overrides,
  }) as SupportRequestView;

const plane = (overrides: Partial<AircraftTelemetryEntry>): AircraftTelemetryEntry =>
  ({
    aircraftId: 'CAS-1',
    aircraftType: 'cas',
    status: 'ready',
    damaged: false,
    position: { x: 0, y: 1000 },
    speedMps: 100,
    takeoffSeconds: 60,
    ammunition: 4,
    gunBursts: 10,
    availableInSeconds: 0,
    casPhase: null,
    ...overrides,
  }) as AircraftTelemetryEntry;

describe('answering a support request', () => {
  it('lists every strike aircraft, available ones first with an ETA, the rest with a reason', () => {
    const options = supportOptions(
      request(),
      [
        plane({ aircraftId: 'CAS-2' as never, status: 'turnaround', availableInSeconds: 300 }),
        plane({}),
        plane({ aircraftId: 'RECON-1' as never, aircraftType: 'recon' }),
        plane({ aircraftId: 'CAS-3' as never, ammunition: 0, gunBursts: 0, status: 'onStation' }),
      ],
      clock,
      100,
    );
    expect(options.map((o) => o.aircraftId)).toEqual(['CAS-1', 'CAS-2', 'CAS-3']);
    expect(options[0]).toMatchObject({ available: true, etaSeconds: 70 });
    expect(options[1]).toMatchObject({ available: false, reason: 'rearming until t400' });
    expect(options[2]?.reason).toBe('nothing left to fire');
  });

  it('says where the answer stands: waiting, inbound with its ETA, or over them', () => {
    expect(requestStatus(request(), [], clock, 100)).toBe('Waiting for your answer.');
    const inbound = request({ answer: { kind: 'inbound', aircraftId: 'CAS-1', etaAt: 250, answeredAt: 100 } });
    expect(requestStatus(inbound, [plane({ status: 'enroute' })], clock, 130)).toBe('CAS-1 inbound, ETA t250 (in 2:00).');
    expect(requestStatus(inbound, [plane({ status: 'onStation', casPhase: 'target-acquired' })], clock, 260)).toBe('CAS-1 is over them: TALLY.');
    expect(requestStatus(request({ answer: { kind: 'none', answeredAt: 90 } }), [], clock, 100)).toContain('no air');
  });

  it('keeps a request on the board until it is answered and settled', () => {
    expect(showRequest(request(), [], 100)).toBe(true);
    const told = request({ answer: { kind: 'none', answeredAt: 0 } });
    expect(showRequest(told, [], 300)).toBe(true);
    expect(showRequest(told, [], 5000)).toBe(false);
    expect(showRequest({ ...told, dangerCloseUntil: 6000 }, [], 5000)).toBe(true);
  });
});
