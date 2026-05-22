const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart',
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
  await supabase.from('escalations').insert({
    phone,
    reason,
    context: context || '',
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (context || '').slice(0, 200),
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: recent } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!recent || recent.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeks = recent.map((c) => c.week_no).sort((a, b) => b - a);
  const gap = weeks[0] - weeks[1];
  if (gap >= 3) {
    await escalate(
      client.phone,
      '2+ consecutive missed check-ins',
      `Client ${client.name || 'unknown'} — last check-in was week ${weeks[0]}, gap of ${gap} weeks`
    );
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
