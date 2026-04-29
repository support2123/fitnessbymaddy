const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n\nContext:\n${JSON.stringify(context, null, 2)}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, context.phone || 'unknown']);

  return { escalated: true, reason };
}

async function checkMissedCheckins(clientId, db) {
  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return false;

  const { data: client } = await db
    .from('clients')
    .select('program_started_at, phone')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
  const latestCheckin = checkins[0].week_no;

  if (weeksElapsed - latestCheckin >= 2) {
    await escalateToMaddy('2 consecutive missed check-ins', {
      client_id: clientId,
      phone: client.phone,
      weeks_elapsed: weeksElapsed,
      last_checkin_week: latestCheckin
    });
    return true;
  }

  return false;
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
