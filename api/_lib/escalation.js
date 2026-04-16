import { supa } from './supabase.js';
import { sendWhatsApp } from './whatsapp.js';
import { maskPhone } from './mask.js';

// Keywords that require Maddy's human judgment
const RED_FLAGS = [
  { pattern: /\b(injur(y|ed)|fracture|sprain|torn|surgery)\b/i,           reason: 'injury' },
  { pattern: /\b(pregnan(t|cy)|expecting|trimester)\b/i,                   reason: 'pregnancy' },
  { pattern: /\b(medicat(ion|ing)|prescribed|medicine|tablet|pill|drug)\b/i, reason: 'medication' },
  { pattern: /\b(diabet|thyroid disease|bp|blood pressure|heart|cardiac)\b/i, reason: 'medical_condition' },
  { pattern: /\b(pain|hurt|ache)\b/i,                                      reason: 'pain_report' },
  { pattern: /\b(dizzy|faint|nausea|vomit)\b/i,                            reason: 'health_symptom' },
  { pattern: /\b(anorex|bulim|binge|starv|purge|not eating)\b/i,           reason: 'disordered_eating' },
  { pattern: /\brefund\b/i,                                                reason: 'refund_request' },
  { pattern: /\blawyer|attorney|legal\b/i,                                 reason: 'legal_threat' },
  { pattern: /\bcomplaint|complain\b/i,                                    reason: 'complaint' },
  { pattern: /didn.?t work|not working|no result/i,                        reason: 'result_dispute' },
  { pattern: /side.?effect/i,                                              reason: 'side_effect' },
];

export function detectRedFlags(text) {
  if (!text) return [];
  return RED_FLAGS.filter(r => r.pattern.test(text)).map(r => r.reason);
}

export async function escalate({ phone, leadId = null, clientId = null, reason, context }) {
  const db = supa();
  await db.from('escalations').insert({
    phone, lead_id: leadId, client_id: clientId, reason, context
  });

  if (process.env.AUTO_ESCALATE === 'false') return;
  const maddy = process.env.MADDY_WHATSAPP;
  if (!maddy) return;

  const body =
    `⚠️ Escalation [${reason}]\n` +
    `From: ${maskPhone(phone)}\n` +
    (context ? `Context: ${String(context).slice(0, 500)}` : '');

  try {
    await sendWhatsApp({ to: maddy, body, bypassRateLimit: true, kind: 'escalation' });
  } catch (e) {
    console.error('escalate: failed to notify Maddy', e?.message || e);
  }
}
