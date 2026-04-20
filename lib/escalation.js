const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./utils');

async function escalateToMaddy(phone, reason, messageBody, clientId = null) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId,
    reason,
    message_body: messageBody,
    resolved: false
  });

  const maddyPhone = process.env.MADDY_PHONE;
  if (maddyPhone) {
    await sendTemplate(maddyPhone, 'escalation_alert', [
      reason,
      maskPhone(phone),
      (messageBody || '').slice(0, 200)
    ]);
  }

  console.log(`[ESCALATION] ${reason} from ${maskPhone(phone)}`);
}

async function checkConsecutiveMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  const start = new Date(client.program_started_at);
  const now = new Date();
  const currentWeek = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000)) + 1;

  if (currentWeek < 3) return;

  const submittedWeeks = new Set((checkins || []).map(c => c.week_no));
  const lastTwo = [currentWeek - 1, currentWeek - 2];
  const missedBoth = lastTwo.every(w => !submittedWeeks.has(w));

  if (missedBoth) {
    await escalateToMaddy(
      client.phone,
      '2 consecutive missed check-ins',
      `Client missed weeks ${lastTwo.join(' and ')}`,
      clientId
    );
  }
}

module.exports = { escalateToMaddy, checkConsecutiveMissedCheckins };
