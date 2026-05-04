const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'purge', 'binge', 'anorexia', 'bulimia'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate({ phone, reason, messageBody }) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, masked]
  });
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = checkins.map(c => c.week_no);
  let consecutiveMissed = 0;

  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await escalate({
      phone: client.phone,
      reason: '2 consecutive missed check-ins',
      messageBody: `Client has missed ${consecutiveMissed} consecutive check-ins`
    });
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins, ESCALATION_KEYWORDS };
