const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'hospital',
];

const MADDY_PHONE = '+917082478374';

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function getEscalationReason(messageBody) {
  const lower = messageBody.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter((kw) => lower.includes(kw));
  return matched.join(', ');
}

async function createEscalation(phone, clientId, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  const alertMsg = `ALERT: Escalation needed\nPhone: ${maskPhone(phone)}\nReason: ${reason}\nMessage: "${messageBody ? messageBody.slice(0, 200) : 'N/A'}"`;

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
    to: 'support@fitnessbymaddy.com',
    subject: `Escalation: ${reason}`,
    text: alertMsg,
  }).catch((err) => console.error('Email escalation failed:', err));

  return alertMsg;
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return false;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at, phone')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const lastCheckin = checkins[0].week_no;
  const missedConsecutive = weeksElapsed - lastCheckin;

  if (missedConsecutive >= 2) {
    await createEscalation(
      client.phone,
      clientId,
      '2 consecutive missed check-ins',
      `Client missed weeks ${lastCheckin + 1} and ${lastCheckin + 2}`
    );
    return true;
  }

  return false;
}

module.exports = {
  needsEscalation,
  getEscalationReason,
  createEscalation,
  checkMissedCheckins,
};
