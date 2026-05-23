const { getSupabase } = require('./supabase');
const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await notifyMaddy(reason, `Phone: ${maskPhone(phone)}\nMessage: ${messageBody}`);
}

async function checkMissedCheckins(clientId, phone) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('program_started_at')
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
    .limit(3);

  const submittedWeeks = new Set((checkins || []).map(c => c.week_no));
  let consecutiveMissed = 0;

  for (let w = weeksActive; w >= 1 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.has(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(phone, '2 consecutive missed check-ins', `Client ${clientId} missed ${consecutiveMissed} check-ins`);
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
