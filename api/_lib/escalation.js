const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function createEscalation(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 100),
  ]);
}

async function checkMissedCheckins(clientId, phone) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = data.map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(phone, '2 consecutive missed check-ins', `Client ${clientId} missed ${consecutiveMissed} weeks`);
  }
}

module.exports = {
  needsEscalation,
  isOptOut,
  createEscalation,
  checkMissedCheckins,
};
