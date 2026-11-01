import {
  strengthCategory,
  strengthMidpoint,
  type ContactEstimate,
} from '../domain/public/estimates';
import { distance } from '../domain/public/geometry';
import type { UnitKnowledge } from '../domain/public/ground';

/** Contacts this close are one enemy to the platoon that sees them (§4.0.1). */
const GROUP_RADIUS_METERS = 200;

function membersOf(knowledge: UnitKnowledge, lead: ContactEstimate): readonly ContactEstimate[] {
  const members: ContactEstimate[] = [];
  for (const contact of Object.values(knowledge.contacts)) {
    if (contact.identification !== lead.identification) continue;
    if (distance(contact.position.center, lead.position.center) <= GROUP_RADIUS_METERS) members.push(contact);
  }
  return members;
}

/** Headcount the unit believes is around a contact, the contact included. */
export function groupStrength(knowledge: UnitKnowledge, contact: ContactEstimate): number {
  if (Object.keys(knowledge.contacts).length <= 1) return strengthMidpoint(contact.strength);
  const members = membersOf(knowledge, contact);
  const others = members.filter((member) => member.contactId !== contact.contactId);
  return others.reduce((sum, member) => sum + strengthMidpoint(member.strength), strengthMidpoint(contact.strength));
}

/** The contact as the platoon reports it: one group, with its combined strength. */
export function groupedContact(knowledge: UnitKnowledge, contact: ContactEstimate): ContactEstimate {
  if (!membersOf(knowledge, contact).some((member) => member.contactId !== contact.contactId)) return contact;
  return { ...contact, strength: strengthCategory(groupStrength(knowledge, contact)) };
}

/**
 * Picks one contact to speak for each group, breaking ties by ID, so that a platoon
 * facing five squads makes one report.
 */
export function groupLeads(knowledge: UnitKnowledge): readonly ContactEstimate[] {
  const leads: ContactEstimate[] = [];
  const covered = new Set<string>();
  for (const id of Object.keys(knowledge.contacts).sort()) {
    const contact = knowledge.contacts[id];
    if (contact === undefined || covered.has(contact.contactId)) continue;
    leads.push(contact);
    for (const member of membersOf(knowledge, contact)) covered.add(member.contactId);
  }
  return leads;
}
