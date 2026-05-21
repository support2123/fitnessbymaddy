const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'faint', 'eating disorder', 'anorexia',
  'bulimia', 'purge', 'starving myself', 'medical condition',
  'surgery', 'heart', 'diabetes'
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    reason,
    (messageBody || '').slice(0, 100)
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: client } = await supabase
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length < 1) return;

  const weekNos = checkins.map(c => c.week_no);
  const maxWeek = Math.max(...weekNos);

  if (maxWeek >= 3) {
    const expected = [maxWeek, maxWeek - 1];
    const submitted = new Set(weekNos);
    const missed = expected.filter(w => !submitted.has(w));
    if (missed.length >= 2) {
      await escalate(
        client.phone,
        '2 consecutive missed check-ins',
        `Client ${client.name} missed weeks ${missed.join(', ')}`
      );
    }
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
