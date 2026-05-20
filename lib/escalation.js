const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'faint', 'chest pain', 'heart'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

async function createEscalation(phone, reason, triggerMessage, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (triggerMessage || '').slice(0, 100)
  ]);
}

async function checkMissedCheckins(clientId, phone) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = new Set((data || []).map(c => c.week_no));
  let consecutive = 0;
  for (let w = weeksElapsed; w > 0 && consecutive < 2; w--) {
    if (!submittedWeeks.has(w)) consecutive++;
    else break;
  }

  if (consecutive >= 2) {
    await createEscalation(phone, '2 consecutive missed check-ins', null, clientId);
  }
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins };
