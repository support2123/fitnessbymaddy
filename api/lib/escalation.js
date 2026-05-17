const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'bulimi', 'anorexi',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate({ phone, reason, messageBody }) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: `ESCALATION: ${reason} from ${phone}`,
    params: [reason, phone.slice(-4)]
  });
}

async function checkMissedCheckins(clientId) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data) return false;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = data.map(d => d.week_no);
  let consecutiveMissed = 0;

  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  return consecutiveMissed >= 2;
}

module.exports = { needsEscalation, escalate, checkMissedCheckins, ESCALATION_KEYWORDS };
