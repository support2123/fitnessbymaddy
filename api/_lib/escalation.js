const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'faint', 'chest pain', 'heart'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.join(', ');
}

async function escalateToMaddy({ phone, reason, messageBody, clientId }) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  const alertText = [
    'ESCALATION ALERT',
    `Phone: ${phone}`,
    `Reason: ${reason}`,
    messageBody ? `Message: "${messageBody.slice(0, 200)}"` : ''
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: alertText,
    params: [reason, phone]
  });
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    const { count } = await db
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id);

    const missed = weeksElapsed - (count || 0);
    if (missed >= 2) {
      await escalateToMaddy({
        phone: client.phone,
        reason: `2+ consecutive missed check-ins (${missed} missed)`,
        clientId: client.id
      });
    }
  }
}

module.exports = {
  needsEscalation,
  getEscalationReason,
  escalateToMaddy,
  checkMissedCheckins,
  ESCALATION_KEYWORDS
};
