const { getSupabase } = require('./supabase');
const { maskPhone } = require('./utils');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'vomit',
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  await notifyMaddy(phone, reason, messageBody);
}

async function checkMissedCheckins(clientId, phone) {
  const db = getSupabase();
  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: client } = await db
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );

  const lastCheckinWeek = checkins[0]?.week_no || 0;
  const missedConsecutive = weeksElapsed - lastCheckinWeek;

  if (missedConsecutive >= 2) {
    await createEscalation(
      phone,
      '2 consecutive missed check-ins',
      `Client missed weeks ${lastCheckinWeek + 1} and ${lastCheckinWeek + 2}`
    );
  }
}

async function notifyMaddy(phone, reason, messageBody) {
  const { sendWhatsApp } = require('./whatsapp');
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';

  await sendWhatsApp(maddyPhone, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 200),
  ]);
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins };
