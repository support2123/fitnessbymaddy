const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./mask');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'faint', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'not eating', 'medical'
];

function checkEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function checkOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function createEscalation(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 100)
  ]);

  console.log(`Escalation created: ${reason} for ${maskPhone(phone)}`);
}

async function escalateMissedCheckins(clientId, phone, missedCount) {
  if (missedCount >= 2) {
    await createEscalation(
      phone,
      `${missedCount} consecutive missed check-ins`,
      `Client has missed ${missedCount} consecutive weekly check-ins`
    );
  }
}

module.exports = { checkEscalation, checkOptOut, createEscalation, escalateMissedCheckins };
