const supabase = require('./supabase');
const { sendText } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'fainting', 'chest pain', 'heart',
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody ? messageBody.substring(0, 500) : null,
  });

  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  const alert = `ESCALATION ALERT\nFrom: ${masked}\nReason: ${reason}\nMessage: ${messageBody ? messageBody.substring(0, 200) : 'N/A'}`;

  await sendText(MADDY_PHONE, alert);
}

async function checkMissedCheckins(clientId, phone) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = checkins.map(c => c.week_no);
  let consecutive = 0;
  for (let w = weeksElapsed; w > 0 && consecutive < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutive++;
    else break;
  }

  if (consecutive >= 2) {
    await escalate(phone, '2 consecutive missed check-ins', null);
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
