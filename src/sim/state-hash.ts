import { hashState } from '../domain/public/hash';
import type { Aircraft, Platoon } from '../domain/truth/world';
import type { SimState } from './state';

/**
 * The state without its accounting: the fields below are written for reports and diagnostics and
 * never read by a decision or a random draw. A new field of that kind belongs in this list, so
 * that adding it leaves the replay hash alone.
 */
const withoutAircraftAccounting = ({ record: _record, ...aircraft }: Aircraft): Omit<Aircraft, 'record'> => aircraft;
const withoutPlatoonDiagnostics = ({ drillWaitReason: _reason, ...platoon }: Platoon): Omit<Platoon, 'drillWaitReason'> => platoon;

export function gameplayState(state: SimState): unknown {
  return {
    ...state,
    truth: {
      ...state.truth,
      aircraft: state.truth.aircraft.map(withoutAircraftAccounting),
      platoons: Object.fromEntries(Object.entries(state.truth.platoons).map(([id, platoon]) => [id, withoutPlatoonDiagnostics(platoon)])),
    },
  };
}

/** The replay hash: equal whenever two runs would play the same from here on. */
export function gameplayHash(state: SimState): string {
  return hashState(gameplayState(state));
}
