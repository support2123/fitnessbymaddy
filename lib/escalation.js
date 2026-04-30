const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'not eating', 'faint', 'vomit',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return msg;
}

async function checkConsecutiveMissed(supabase, clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = (checkins || []).map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await escalateToMaddy(
      '2 consecutive missed check-ins',
      `Client: ${client.name || 'Unknown'} (${client.phone})`
    );
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkConsecutiveMissed };
