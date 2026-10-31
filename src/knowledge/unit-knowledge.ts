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
    case 'ACKNOWLEDGEMENT':
      if (message.supportCancelled) knowledge.expectedSupport = null;
      else if (message.support !== null) knowledge.expectedSupport = message.support;
      return;
    case 'POSITION_REPORT':
    case 'SITREP':
    case 'SUPPORT_REQUEST':
    case 'COMMAND_UPDATE':
    case 'STRIKE_RESULT':
    case 'GROUND_FIRE':
      return;
  }
}
