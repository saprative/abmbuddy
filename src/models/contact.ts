import { z } from "zod";

/**
 * A person already on the account in the CRM, used for stakeholder mapping.
 *
 * Note what is deliberately absent: no email address, no phone number, no
 * message history. Stakeholder mapping needs to know who someone is and what
 * they are responsible for — it does not need their contact details, so those
 * are never read out of HubSpot and can never reach a model.
 */
export const contactSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  /** Where they sit, when the CRM records it. */
  function: z.string().optional(),
  seniority: z.string().optional(),
  linkedinUrl: z.string().optional(),
  lifecycleStage: z.string().optional(),
  lastActivityAt: z.string().optional(),
});

export type Contact = z.infer<typeof contactSchema>;

/** Compact roster for an agent prompt: identity and role only. */
export function renderContacts(contacts: Contact[]): string {
  if (!contacts.length) return "(no contacts on this account in the CRM)";
  return contacts
    .map((contact) => {
      const bits = [
        `[contact:${contact.id}] ${contact.name}`,
        contact.title ? `— ${contact.title}` : "",
        contact.seniority ? `(${contact.seniority})` : "",
        contact.lifecycleStage ? `· ${contact.lifecycleStage}` : "",
        contact.lastActivityAt ? `· last activity ${contact.lastActivityAt}` : "",
      ].filter(Boolean);
      return bits.join(" ");
    })
    .join("\n");
}
