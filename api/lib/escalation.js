const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const params = [
    reason,
    context.phone || 'unknown',
    (context.message || '').slice(0, 200),
  ];

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', params);
}

async function checkMissedCheckins(db) {
  const { data: missed } = await db.rpc('get_clients_with_consecutive_missed_checkins');
  if (!missed) return;

  for (const client of missed) {
    await escalateToMaddy('2 consecutive missed check-ins', {
      phone: client.phone,
      message: `Client ${client.name || client.phone} has missed 2 consecutive check-ins`,
    });
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
