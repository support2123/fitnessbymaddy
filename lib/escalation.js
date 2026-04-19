const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating', 'starving'
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation(phone, reason, messageBody, clientId = null) {
  const { data, error } = await supabase.from('escalations').insert({
    phone,
    client_id: clientId,
    reason,
    message_body: messageBody?.substring(0, 1000),
    resolved: false
  }).select().single();

  if (error) {
    console.error('[Escalation] Insert failed:', error.message);
    return null;
  }

  await notifyMaddy(phone, reason, messageBody);
  return data;
}

async function notifyMaddy(phone, reason, messageBody) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const preview = messageBody ? messageBody.substring(0, 100) : 'No message';

  await sendTemplate(maddyPhone, 'escalation_alert', [
    maskPhone(phone),
    reason,
    preview
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: missed } = await supabase
    .from('clients')
    .select(`
      id, phone, name,
      checkins(week_no, form_submitted_at)
    `)
    .eq('id', clientId)
    .single();

  if (!missed) return false;

  const { data: latestCheckins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!latestCheckins || latestCheckins.length < 2) return false;

  const weekNos = latestCheckins.map(c => c.week_no);
  const maxWeek = Math.max(...weekNos);
  const hasTwoConsecutiveMissing =
    !weekNos.includes(maxWeek) && !weekNos.includes(maxWeek - 1);

  if (hasTwoConsecutiveMissing) {
    await createEscalation(
      missed.phone,
      '2 consecutive missed check-ins',
      `Client ${missed.name || maskPhone(missed.phone)} missed weeks ${maxWeek - 1} and ${maxWeek}`,
      clientId
    );
    return true;
  }

  return false;
}

module.exports = {
  needsEscalation,
  createEscalation,
  checkMissedCheckins,
  ESCALATION_KEYWORDS
};
