const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'chest pain'
];

function shouldEscalate(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();
  const masked = maskPhone(phone);

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    (messageBody || '').slice(0, 200)
  ]);

  return true;
}

async function checkMissedCheckins(clientId, phone) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!checkins) return;

  const weeks = checkins.map(c => c.week_no);
  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const currentWeek = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000)) + 1;

  let consecutiveMissed = 0;
  for (let w = currentWeek; w >= Math.max(1, currentWeek - 2); w--) {
    if (!weeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(phone, '2 consecutive missed check-ins', `Client missed weeks ${currentWeek - 1} and ${currentWeek}`);
  }
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
