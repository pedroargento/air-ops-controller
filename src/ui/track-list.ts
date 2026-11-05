import { isAntiAir } from '../domain/public/equipment';
import { strengthMidpoint } from '../domain/public/estimates';
import type { ContactMarker } from '../knowledge/player-view';
import { contactCondition } from './map-conventions';

/*
 * The track list: every enemy track air operations holds, in an order the controller chooses,
 * so they can be worked through without hunting for them on the map.
 */

export type TrackSort = 'threat' | 'firing' | 'age' | 'condition';

/** How urgently a track wants attention: air defense first, then whoever is fighting, then the rest. */
export function threatScore(marker: ContactMarker): number {
  const { contact } = marker;
  if (contact.identification === 'friendly') return -1;
  const antiAir = contact.observedWeapons.some(isAntiAir) ? 1000 : 0;
  const fighting = marker.engaging ? 100 : 0;
  const side = contact.identification === 'hostile' ? (contact.confidence === 'low' ? 20 : 40) : 0;
  return antiAir + fighting + side + Math.min(30, strengthMidpoint(contact.strength) / 2);
}

function lostShare(marker: ContactMarker): number {
  return contactCondition(marker.estimatedLosses, marker.contact.strength)?.lostShare ?? 0;
}

/** Enemy and unidentified tracks still worth a look, sorted. Destroyed ones go last. */
export function sortedTracks(
  contacts: readonly ContactMarker[],
  sort: TrackSort,
  /** Friendly units each track is known to be firing on (§7.3). */
  firingOn: (key: string) => number = () => 0,
): readonly ContactMarker[] {
  const tracks = contacts.filter((marker) => marker.contact.identification !== 'friendly');
  const gone = (marker: ContactMarker): number => (marker.status === 'destroyed' ? 1 : 0);
  const order = (a: ContactMarker, b: ContactMarker): number => {
    switch (sort) {
      case 'threat':
        return threatScore(b) - threatScore(a);
      case 'firing':
        return firingOn(b.key) - firingOn(a.key) || threatScore(b) - threatScore(a);
      case 'age':
        return a.ageSeconds - b.ageSeconds;
      case 'condition':
        return lostShare(a) - lostShare(b);
    }
  };
  return [...tracks].sort((a, b) => gone(a) - gone(b) || order(a, b) || a.ageSeconds - b.ageSeconds || (a.key < b.key ? -1 : 1));
}
