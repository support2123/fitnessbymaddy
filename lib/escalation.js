const { sendTextMessage, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, messageBody) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) return;

  const masked = maskPhone(phone);
  const alert = `ESCALATION ALERT\nReason: ${reason}\nLead: ${masked}\nMessage: "${(messageBody || '').slice(0, 200)}"`;

  await sendTextMessage(maddyPhone, alert);
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const startDate = new Date(client.program_started_at);
    const weeksIn = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (weeksIn < 2) continue;

    const { data: checkins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `Client ${client.name || 'unknown'} has no check-ins after ${weeksIn} weeks`
      );
    } else if (checkins.length < 2 && weeksIn >= 3) {
      const lastWeek = checkins[0].week_no;
      if (weeksIn - lastWeek >= 2) {
        await escalateToMaddy(
          '2 consecutive missed check-ins',
          client.phone,
          `Client ${client.name || 'unknown'} last checked in week ${lastWeek}, now week ${weeksIn}`
        );
      }
    }
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
