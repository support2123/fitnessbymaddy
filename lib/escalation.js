const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
];

const MEDICAL_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'chest pain',
];

const OPTOUT_KEYWORDS = ['stop', 'unsubscribe'];

function checkOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return OPTOUT_KEYWORDS.some(k => lower === k);
}

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: `Message contains "${keyword}"` };
    }
  }
  for (const keyword of MEDICAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: `Medical/safety flag: "${keyword}"` };
    }
  }
  return { escalate: false };
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
  ]).catch(() => {});
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const latestWeek = checkins[0].week_no;
  const { data: programs } = await db
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (!programs || programs.length === 0) return;

  const expectedWeek = programs[0].week_no;
  const missedCount = expectedWeek - latestWeek;

  if (missedCount >= 2) {
    await createEscalation(
      client.phone,
      `2 consecutive missed check-ins (last: week ${latestWeek}, expected: week ${expectedWeek})`,
      null,
      clientId
    );
  }
}

module.exports = {
  checkOptOut,
  checkEscalation,
  createEscalation,
  checkMissedCheckins,
  MADDY_PHONE,
};
