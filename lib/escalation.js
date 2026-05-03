const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'vomit',
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalate(phone, reason, context) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    context,
    resolved: false,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.slice(-4),
    context ? context.slice(0, 100) : 'No context',
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
    (Date.now() - new Date(client.program_started_at).getTime()) /
    (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const latestWeek = checkins[0].week_no;
  if (weeksActive - latestWeek >= 2) {
    await escalate(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || 'unknown'} last checked in at week ${latestWeek}, now at week ${weeksActive}`
    );
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
