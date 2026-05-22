const { supabase } = require('./supabase');
const { sendEscalationAlert } = require('./whatsapp');

async function createEscalation({ phone, clientId, reason, messageBody }) {
  const { data, error } = await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  }).select().single();

  if (error) {
    console.error('[Escalation] DB insert failed:', error.message);
    return null;
  }

  await sendEscalationAlert(phone, reason, messageBody);
  return data;
}

async function checkConsecutiveMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) /
    (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = (checkins || []).map(c => c.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await createEscalation({
      phone: client.phone,
      clientId,
      reason: '2 consecutive missed check-ins',
      messageBody: `Client missed weeks ${weeksElapsed - 1} and ${weeksElapsed}`,
    });
  }
}

module.exports = { createEscalation, checkConsecutiveMissedCheckins };
