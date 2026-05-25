const { sendMessage, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `🚨 ESCALATION NEEDED\n\nReason: ${reason}\nPhone: ${maskPhone(context.phone)}\nName: ${context.name || 'Unknown'}\n\nMessage: "${(context.message || '').slice(0, 200)}"`;

  await sendMessage(MADDY_PHONE, msg, {
    isClient: true,
    templateName: 'escalation_alert',
    params: {
      templateParams: [reason, context.name || 'Unknown', maskPhone(context.phone)]
    }
  });
}

async function checkMissedCheckins(clientId, db) {
  const { data: recent } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!recent || recent.length === 0) return false;

  const { data: client } = await db
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = recent.map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksActive; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy('2 consecutive missed check-ins', {
      phone: client.phone,
      name: client.name,
      message: `Client has missed ${consecutiveMissed} consecutive weekly check-ins.`
    });
    return true;
  }
  return false;
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
