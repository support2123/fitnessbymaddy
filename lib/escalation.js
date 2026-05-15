const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'vomiting', 'faint', 'chest pain', 'heart',
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return 'unknown';
}

async function escalateToMaddy({ phone, clientId, reason, messageBody }) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  const masked = phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, masked],
  });
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const latestWeek = checkins[0]?.week_no || 0;
  const missedConsecutive = weeksElapsed - latestWeek;

  if (missedConsecutive >= 2) {
    await escalateToMaddy({
      phone: client.phone,
      clientId,
      reason: '2 consecutive missed check-ins',
      messageBody: `Client missed ${missedConsecutive} consecutive check-ins`,
    });
  }
}

module.exports = {
  needsEscalation,
  getEscalationReason,
  escalateToMaddy,
  checkMissedCheckins,
  ESCALATION_KEYWORDS,
};
