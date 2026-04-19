const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'bulimia', 'anorexia', 'purge', 'vomit'
];

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return STOP_KEYWORDS.some(kw => lower === kw || lower.includes(kw));
}

async function triggerEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    phone.slice(-4),
    reason,
    (messageBody || '').slice(0, 100)
  ]);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { count } = await db
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('week_no', weeksActive - 1);

  if (count === 0 && weeksActive >= 2) {
    await triggerEscalation(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || 'Unknown'} has missed 2+ consecutive check-ins`
    );
  }
}

module.exports = { checkEscalation, checkOptOut, triggerEscalation, checkMissedCheckins };
