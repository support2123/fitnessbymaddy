const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function escalate(phone, triggerKeyword, messageBody) {
  const db = getSupabase();
  await db.from('escalations').insert({
    phone,
    trigger_keyword: triggerKeyword,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      triggerKeyword,
      phone.slice(-4),
      messageBody.slice(0, 200)
    ]
  });
}

async function escalateMissedCheckins(clientId, phone, missedCount) {
  if (missedCount >= 2) {
    await escalate(phone, `${missedCount}_missed_checkins`, `Client missed ${missedCount} consecutive check-ins`);
  }
}

module.exports = { needsEscalation, escalate, escalateMissedCheckins };
