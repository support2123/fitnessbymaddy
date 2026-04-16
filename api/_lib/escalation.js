import { db } from './supabase.js';
import { sendWhatsApp } from './whatsapp.js';
import { maskPhone, normalisePhone } from './util.js';

// Words that immediately route to a human.
export const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'didnt work',
  'side effect', 'pain', 'dizzy', 'dizziness', 'injury', 'injured',
  'pregnant', 'pregnancy', 'medication', 'medicine', 'medical',
  'eating disorder', 'starving', 'starve myself', 'binge',
];

export function detectEscalation(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (t.includes(kw)) return kw;
  }
  return null;
}

export async function escalate({
  phone, leadId = null, clientId = null, trigger, context = '',
}) {
  const safePhone = normalisePhone(phone);
  await db().from('escalations').insert({
    phone: safePhone, lead_id: leadId, client_id: clientId, trigger, context,
  });

  const maddy = process.env.MADDY_WHATSAPP;
  if (maddy) {
    await sendWhatsApp({
      phone: maddy.startsWith('+') ? maddy : `+${maddy}`,
      body:
        `[Escalation] ${trigger}\n` +
        `From: ${maskPhone(safePhone)}\n` +
        `Context: ${context.slice(0, 280)}`,
      bypassRateLimit: true,
      meta: { kind: 'escalation' },
    });
  }
}
