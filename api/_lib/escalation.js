const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'hospital', 'doctor',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, context) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    reason,
    `Lead/Client: ${masked}\nReason: ${reason}\nContext: ${context || 'N/A'}\n\nPlease review manually.`
  );
}

async function checkMissedCheckins(supabase) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const { data: checkins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const { data: programs } = await supabase
      .from('programs')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const lastCheckin = checkins?.[0]?.week_no || 0;
    const lastProgram = programs?.[0]?.week_no || 0;
    const expectedWeek = lastProgram > 0 ? lastProgram : 1;

    if (expectedWeek - lastCheckin >= 2) {
      await escalate(
        client.phone,
        '2 consecutive missed check-ins',
        `Client: ${client.name || 'Unknown'}, last check-in: week ${lastCheckin}, expected: week ${expectedWeek}`
      );
    }
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins, ESCALATION_KEYWORDS };
