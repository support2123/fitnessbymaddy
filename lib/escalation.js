const { getSupabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'not eating', 'purging', 'starving',
];

function shouldEscalate(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 100),
  ]);
}

async function checkConsecutiveMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );

  if (weeksActive < 2) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const lastTwo = [weeksActive, weeksActive - 1];
  const submitted = (checkins || []).map((c) => c.week_no);

  if (!lastTwo.some((w) => submitted.includes(w))) {
    await createEscalation(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${clientId} missed weeks ${lastTwo.join(' and ')}`,
      clientId
    );
  }
}

module.exports = {
  shouldEscalate,
  createEscalation,
  checkConsecutiveMissedCheckins,
  ESCALATION_KEYWORDS,
};
