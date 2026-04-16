// Detects messages that need a human (Maddy) and records them.

import { db, maskPhone } from './supabase.js';
import { sendWhatsApp } from './whatsapp.js';

const RX = [
  { re: /\b(refund|chargeback)\b/i,                              reason: 'refund_request' },
  { re: /\b(lawyer|legal|complaint)\b/i,                         reason: 'legal_threat' },
  { re: /\b(side[- ]effect|didn'?t work|not working|useless)\b/i, reason: 'dissatisfaction' },
  { re: /\b(pregnan(t|cy)|expecting)\b/i,                        reason: 'pregnancy' },
  { re: /\b(injur(y|ed)|slip disc|fracture|torn|sprain)\b/i,     reason: 'injury' },
  { re: /\b(diabet|thyroid|bp|hypertension|cholesterol|pcos|pcod|medication|medicine|pill)\b/i, reason: 'medical_condition' },
  { re: /\b(chest pain|dizz(y|iness)|faint|blackout|palpitation)\b/i, reason: 'acute_symptom' },
  { re: /\b(starv|bing|purg|vomit|anorex|bulim)/i,              reason: 'disordered_eating' },
  { re: /\b(menopaus)/i,                                         reason: 'menopause_flag' }
];

// Returns array of matched reasons (empty if none).
export function detectEscalations(text) {
  if (!text) return [];
  const hits = new Set();
  for (const { re, reason } of RX) if (re.test(text)) hits.add(reason);
  return [...hits];
}

export async function escalate({ phone, body, clientId = null, leadId = null, reason, context }) {
  await db().from('escalations').insert({
    phone, client_id: clientId, lead_id: leadId, reason, context: context || body?.slice(0, 500)
  });
  const maddy = process.env.MADDY_WA_NUMBER;
  if (maddy) {
    const note = `🚨 Escalation [${reason}]\nFrom: ${maskPhone(phone)}\n"${(body || '').slice(0, 200)}"`;
    await sendWhatsApp({ phone: maddy, body: note, force: true });
  }
  console.warn('escalation', reason, maskPhone(phone));
}
