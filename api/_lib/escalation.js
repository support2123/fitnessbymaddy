// Helper: open an escalation row + ping Maddy.
// Centralised so no endpoint has to remember both steps.

import { supabase } from './supabase.js';
import { pingMaddy } from './whatsapp.js';
import { maskPhone } from './utils.js';

export async function openEscalation({ reason, phone, leadId, clientId, payload }) {
  await supabase.from('escalations').insert({
    phone, lead_id: leadId, client_id: clientId, reason, payload,
  });
  const snippet = payload?.snippet || payload?.body || '';
  await pingMaddy(
    `🚨 ESCALATION — ${reason}\n` +
    `Phone: ${maskPhone(phone)}\n` +
    (snippet ? `Msg: "${snippet.slice(0, 140)}"\n` : '') +
    `Resolve: https://fitnessbymaddy.com/admin#escalations`,
  );
}
