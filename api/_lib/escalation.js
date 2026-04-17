const { getSupabase } = require('./supabase');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorex', 'bulimi', 'purge', 'not eating'
];

function needsEscalation(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody) {
  const supabase = getSupabase();

  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  await notifyMaddy(phone, reason);
  console.log(`ESCALATION: ${maskPhone(phone)} — ${reason}`);
}

async function notifyMaddy(phone, reason) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) return;

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return;

  const payload = {
    apiKey,
    campaignName: 'escalation_alert',
    destination: maddyPhone.replace(/^\+/, ''),
    userName: 'Maddy',
    templateParams: [maskPhone(phone), reason],
    source: 'fitnessbymaddy-automation',
    media: {},
  };

  await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

module.exports = { needsEscalation, createEscalation, ESCALATION_KEYWORDS };
