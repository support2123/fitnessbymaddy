const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'vomit'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const masked = phone ? phone.slice(0, 3) + 'XXX...' + phone.slice(-3) : 'unknown';
  const alert = [
    `ESCALATION ALERT`,
    `Reason: ${reason}`,
    `Client: ${clientName || 'Unknown'}`,
    `Phone: ${masked}`,
    message ? `Message: "${message.slice(0, 200)}"` : '',
    `Action needed — please review.`
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    message: alert,
    templateName: 'escalation_alert'
  });

  return true;
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const { data: checkins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) continue;

    const weeksActive = Math.ceil(
      (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const latestCheckin = checkins[0]?.week_no || 0;

    if (weeksActive - latestCheckin >= 2) {
      await escalateToMaddy({
        reason: '2 consecutive missed check-ins',
        phone: client.phone,
        clientName: client.name
      });
    }
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
