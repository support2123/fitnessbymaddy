const { getSupabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'heart', 'chest pain',
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  if (['refund', 'lawyer', 'complaint', "didn't work"].some((k) => lower.includes(k))) {
    return 'complaint_or_refund';
  }
  if (['injury', 'pregnant', 'pregnancy', 'medication', 'surgery'].some((k) => lower.includes(k))) {
    return 'medical_condition';
  }
  if (['pain', 'dizziness', 'dizzy', 'faint', 'chest pain', 'heart'].some((k) => lower.includes(k))) {
    return 'health_concern';
  }
  if (['eating disorder', 'anorexia', 'bulimia'].some((k) => lower.includes(k))) {
    return 'disordered_eating';
  }
  return 'unknown';
}

async function escalateToMaddy(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody ? messageBody.substring(0, 500) : null,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    messageBody ? messageBody.substring(0, 200) : 'No message',
  ]);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const lastWeek = checkins[0].week_no;
  if (weeksActive - lastWeek >= 2) {
    await escalateToMaddy(
      client.phone,
      '2_consecutive_missed_checkins',
      `Client has not checked in for ${weeksActive - lastWeek} weeks`
    );
  }
}

module.exports = {
  needsEscalation,
  detectEscalationReason,
  escalateToMaddy,
  checkMissedCheckins,
  ESCALATION_KEYWORDS,
};
