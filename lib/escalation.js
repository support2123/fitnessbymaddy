const { getClient } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'heart', 'diabetes'
];

function shouldEscalate(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation({ phone, clientId, reason, messageBody }) {
  const db = getClient();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    body: `🚨 ESCALATION\nFrom: ${phone}\nReason: ${reason}\nMsg: ${(messageBody || '').slice(0, 200)}`
  });
}

async function checkMissedCheckins(clientId) {
  const db = getClient();
  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length < 1) return false;

  const { data: client } = await db
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = checkins.map(c => c.week_no);
  let missedConsecutive = 0;
  for (let w = weeksElapsed; w > Math.max(0, weeksElapsed - 2); w--) {
    if (!submittedWeeks.includes(w)) missedConsecutive++;
  }

  return missedConsecutive >= 2;
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
