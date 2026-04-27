const { getSupabase } = require('./supabase');
const { maskPhone } = require('./pii');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'not eating', 'faint', 'chest pain', 'heart',
];

const MADDY_PHONE = '+917082478374';

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(phone, clientId, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody ? messageBody.substring(0, 500) : null,
  });

  await notifyMaddy(phone, reason, messageBody);
}

async function notifyMaddy(phone, reason, messageBody) {
  const { sendTemplate } = require('./whatsapp');

  const masked = maskPhone(phone);
  const snippet = messageBody ? messageBody.substring(0, 100) : 'N/A';

  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', [
      reason,
      masked,
      snippet,
    ]);
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }
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
    .eq('client_id', clientId);

  const missed = weeksActive - (count || 0);
  if (missed >= 2) {
    await createEscalation(
      client.phone,
      clientId,
      '2 consecutive missed check-ins',
      `Client ${client.name || maskPhone(client.phone)} has missed ${missed} check-ins`
    );
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
