const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'chest pain'
];

function needsEscalation(message) {
  if (!message) return { escalate: false };
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, reason: keyword };
    }
  }
  return { escalate: false };
}

async function escalateToMaddy(phone, message, reason) {
  const masked = maskPhone(phone);
  const alert = [
    `ESCALATION ALERT`,
    `From: ${masked}`,
    `Reason: "${reason}" detected`,
    `Message: ${message.slice(0, 200)}`
  ];

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', alert);
  console.log(`Escalated to Maddy: ${masked} — reason: ${reason}`);
}

async function escalateMissedCheckins(clientName, phone, missedCount) {
  const masked = maskPhone(phone);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    `MISSED CHECK-IN ALERT`,
    `Client: ${clientName} (${masked})`,
    `${missedCount} consecutive missed check-ins`,
    `Action may be needed`
  ]);
}

module.exports = { needsEscalation, escalateToMaddy, escalateMissedCheckins };
