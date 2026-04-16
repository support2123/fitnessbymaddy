const { admin } = require('./supabase');

const RED_FLAGS = [
  { re: /\b(injur(y|ed)|pain|hurt|sprain|fractur)/i, reason: 'injury_or_pain' },
  { re: /\b(pregnan|expect(ing)?|conceiv|trimester)/i, reason: 'pregnancy' },
  { re: /\b(medic(ation|ine)|diabetes|thyroid|blood\s*pressure|bp|hypertens|heart|cardiac)/i, reason: 'medical_condition' },
  { re: /\b(dizzy|faint|giddy|nause|vomit)/i, reason: 'dizziness_symptom' },
  { re: /\b(not\s*eating|starv|skip.*meal|binge|purge|anorex|bulim)/i, reason: 'disordered_eating_signal' },
  { re: /\b(refund|money\s*back|charge\s*back)/i, reason: 'refund_request' },
  { re: /\b(lawyer|legal|complaint|consumer)/i, reason: 'legal_complaint' },
  { re: /\b(didn'?t\s*work|scam|fraud|fake)/i, reason: 'dissatisfaction' },
  { re: /\b(side\s*effect|reaction|allerg)/i, reason: 'side_effect' },
];

function detect(text) {
  if (!text) return null;
  for (const f of RED_FLAGS) {
    if (f.re.test(text)) return f.reason;
  }
  return null;
}

async function raise({ phone, leadId = null, clientId = null, trigger, detail }) {
  const sb = admin();
  await sb.from('escalations').insert({
    phone, lead_id: leadId, client_id: clientId, trigger, detail,
  });
  if (leadId) {
    await sb.from('leads').update({ escalated: true, escalation_reason: trigger }).eq('id', leadId);
  }
  return true;
}

async function notifyMaddy({ trigger, detail, phone }) {
  const maddy = process.env.MADDY_PHONE;
  if (!maddy) return;
  const { sendText } = require('./aisensy');
  const body = `⚠️ Escalation: ${trigger}\nFrom: ${phone}\n${detail || ''}`.slice(0, 900);
  try { await sendText({ to: maddy, body, bypassRateLimit: true }); }
  catch (_) { /* best-effort */ }
}

module.exports = { detect, raise, notifyMaddy };
