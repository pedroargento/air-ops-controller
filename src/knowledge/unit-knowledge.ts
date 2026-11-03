import type { ContactEstimate } from '../domain/public/estimates';
import type { UnitKnowledge } from '../domain/public/ground';
import type { RadioMessage } from '../domain/public/radio';

function storeReport(knowledge: UnitKnowledge, contact: ContactEstimate): void {
  const key = `${contact.provenance.sourceId}/${contact.contactId}`;
  const existing = knowledge.reports[key];
  if (existing === undefined || contact.position.observedAt >= existing.position.observedAt) {
    knowledge.reports[key] = contact;
  }
}

/** Updates a ground unit's beliefs from a delivered message. */
export function receiveByUnit(knowledge: UnitKnowledge, message: RadioMessage): void {
  switch (message.kind) {
    case 'CONTACT_REPORT':
    case 'INTEL_REPORT':
      storeReport(knowledge, message.contact);
      return;
    case 'TIC':
      if (message.contact !== null) storeReport(knowledge, message.contact);
      return;
    case 'POI_REPORT':
      if (message.cancelled) delete knowledge.pois[message.poi.id];
      else knowledge.pois[message.poi.id] = message.poi;
      return;
    case 'PICKUP_POINT':
      knowledge.pickup = message.point;
      return;
    case 'SUPPRESSION': {
      const { aircraftId } = message.suppression;
      if (message.cancelled) delete knowledge.suppressions[aircraftId];
      else knowledge.suppressions[aircraftId] = message.suppression;
      return;
    }
    case 'ACKNOWLEDGEMENT':
      if (message.supportCancelled) knowledge.expectedSupport = null;
      else if (message.support !== null) knowledge.expectedSupport = message.support;
      // "Nothing available" is an answer: a platoon holding for air stops waiting.
      if (message.support === null) knowledge.supportRefusedAt = message.receivedAt;
      return;
    case 'POSITION_REPORT':
    case 'SITREP':
    case 'SUPPORT_REQUEST':
    case 'CHECK_FIRE':
    case 'DANGER_CLOSE_HOLD':
    case 'DRILL':
    case 'COMMAND_UPDATE':
    case 'STRIKE_RESULT':
    case 'GROUND_FIRE':
      return;
  }
}
