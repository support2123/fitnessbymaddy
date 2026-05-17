const { sendText } = require('./whatsapp');
const { maskPhone } = require('./utils');

const ESCALATION_TRIGGERS = [
  /\b(refund)\b/i,
  /\b(lawyer|legal)\b/i,
  /\b(complaint)\b/i,
  /\b(didn'?t work|not working)\b/i,
  /\b(side effect)\b/i,
  /\b(injury|injured)\b/i,
  /\b(medical|condition)\b/i,
  /\b(pregnant|pregnancy)\b/i,
  /\b(medication|meds)\b/i,
  /\b(pain|painful)\b/i,
  /\b(dizz|dizziness|faint)\b/i,
  /\b(eating disorder|disordered eating|binge|purge)\b/i,
];

function needsEscalation(text) {
  if (!text) return false;
  return ESCALATION_TRIGGERS.some(rx => rx.test(text));
}

async function escalateToMaddy(reason, phone, details) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) return;

  const msg = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `From: ${maskPhone(phone)}`,
    `Details: ${details || 'N/A'}`,
    `Action needed — check admin dashboard.`,
  ].join('\n');

  await sendText(maddyPhone, msg, true);
}

module.exports = { needsEscalation, escalateToMaddy };
