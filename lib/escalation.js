const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint',
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, message) {
  const masked = maskPhone(phone);
  const alert = `ESCALATION: ${reason}\nFrom: ${masked}\nMsg: ${message?.slice(0, 200) || 'N/A'}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked, message?.slice(0, 100) || '']);

  console.log(`[ESCALATION] ${reason} for ${masked}`);
  return { escalated: true, reason };
}

async function checkMissedCheckins(clientId, supabase) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!data) return false;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = data.map(d => d.week_no);
  let consecutiveMissed = 0;

  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy(
      '2 consecutive missed check-ins',
      client.phone,
      `Client ${client.name || 'Unknown'} missed ${consecutiveMissed} check-ins`
    );
    return true;
  }

  return false;
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
