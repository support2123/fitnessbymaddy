const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
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

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody ? messageBody.substring(0, 2000) : null,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone.substring(phone.length - 4),
  ]);
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

  const weekNos = checkins.map((c) => c.week_no);
  const maxWeek = Math.max(...weekNos);

  if (maxWeek >= 3) {
    const hasPrev = weekNos.includes(maxWeek - 1);
    const hasPrevPrev = weekNos.includes(maxWeek - 2);
    if (!hasPrev && !hasPrevPrev) {
      await createEscalation(
        client.phone,
        '2 consecutive missed check-ins',
        `Client ${client.name || clientId} missed weeks ${maxWeek - 1} and ${maxWeek - 2}`
      );
    }
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
