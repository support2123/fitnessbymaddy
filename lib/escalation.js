const { notifyMaddy } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'purge', 'vomit', 'faint'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, messageText) {
  const masked = maskPhone(phone);
  await notifyMaddy(reason, `Lead ${masked}: "${messageText.slice(0, 120)}"`);
}

async function checkMissedCheckins(supabase, clientId, clientPhone) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const completedWeeks = data.map(c => c.week_no);
  const missed = [];
  for (let w = weeksElapsed; w > Math.max(0, weeksElapsed - 2); w--) {
    if (!completedWeeks.includes(w)) missed.push(w);
  }

  if (missed.length >= 2) {
    await escalate(clientPhone, '2 consecutive missed check-ins', `Weeks ${missed.join(', ')} missed`);
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
