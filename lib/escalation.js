const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'chest pain', 'heart',
];

const MADDY_PHONE = '+917082478374';

function checkEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function triggerEscalation(phone, messageBody, triggerKeyword) {
  await supabase.from('escalations').insert({
    phone,
    trigger_keyword: triggerKeyword,
    message_body: messageBody,
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    triggerKeyword,
    (messageBody || '').slice(0, 200),
  ]);
}

async function checkMissedCheckins(clientId) {
  const { data: missed } = await supabase
    .from('clients')
    .select(`
      id, phone, name,
      checkins (week_no)
    `)
    .eq('id', clientId)
    .eq('status', 'active')
    .single();

  if (!missed) return false;

  const { data: latestCheckins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!latestCheckins || latestCheckins.length < 2) return false;

  const weeksSinceStart = Math.floor(
    (Date.now() - new Date(missed.program_started_at).getTime()) /
    (7 * 24 * 60 * 60 * 1000)
  );

  const latestWeek = latestCheckins[0]?.week_no || 0;
  if (weeksSinceStart - latestWeek >= 2) {
    await triggerEscalation(
      missed.phone,
      `Client ${missed.name} has missed 2+ consecutive check-ins`,
      'missed_checkins'
    );
    return true;
  }
  return false;
}

module.exports = { checkEscalation, triggerEscalation, checkMissedCheckins };
