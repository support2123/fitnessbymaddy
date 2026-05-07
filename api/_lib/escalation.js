const { sendMessage } = require('./whatsapp');
const { supabase } = require('./supabase');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'bulimia', 'anorexia', 'not eating', 'puking'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy(phone, reason, context) {
  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  const alertText = `ESCALATION from ${masked}: ${reason}\n\nContext: ${context}`;

  await sendMessage(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.slice(0, 200)]
  });

  console.log(`Escalation sent to Maddy: ${reason}`);
  return { escalated: true };
}

async function checkMissedCheckins(clientId) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const currentWeek = Math.ceil(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  const latestCheckin = data[0]?.week_no || 0;

  if (currentWeek - latestCheckin >= 2) {
    await escalateToMaddy(
      client.phone,
      '2 consecutive missed check-ins',
      `Client: ${client.name}, Program: ${client.program}, Last check-in: Week ${latestCheckin}`
    );
  }
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, checkMissedCheckins };
