const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function detectEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

async function handleEscalation(phone, messageBody, triggerKeyword) {
  await supabase.from('escalations').insert({
    phone,
    trigger_keyword: triggerKeyword,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    triggerKeyword,
    messageBody.slice(0, 200)
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const latestWeek = checkins[0].week_no;
  if (weeksActive - latestWeek >= 2) {
    await handleEscalation(
      client.phone,
      `Client ${client.name} has missed 2+ consecutive check-ins (last: week ${latestWeek}, current: week ${weeksActive})`,
      'missed_checkins'
    );
  }
}

module.exports = { detectEscalation, handleEscalation, checkMissedCheckins };
