const { getSupabase } = require('./supabase');
const { notifyMaddy, maskPhone } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function shouldEscalate(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

async function createEscalation(phone, reason, triggerMessage, clientId) {
  const supabase = getSupabase();
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage
  });

  await notifyMaddy(reason, `Phone: ${maskPhone(phone)}\nMessage: ${triggerMessage}`);
}

async function checkMissedCheckins(clientId, phone) {
  const supabase = getSupabase();
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = checkins.map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(
      phone,
      '2 consecutive missed check-ins',
      `Client has missed ${consecutiveMissed} consecutive weekly check-ins`,
      clientId
    );
  }
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins };
