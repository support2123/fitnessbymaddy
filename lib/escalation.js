const supabase = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalate(phone, reason, messageBody, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.slice(-4),
    messageBody ? messageBody.slice(0, 100) : 'No message'
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: missed } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!missed || missed.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const latestCheckin = missed[0].week_no;
  if (weeksElapsed - latestCheckin >= 2) {
    await escalate(
      client.phone,
      '2 consecutive missed check-ins',
      `Client has not checked in for weeks ${latestCheckin + 1} and ${latestCheckin + 2}`,
      clientId
    );
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
