const { getSupabase } = require('./supabase');
const { sendWhatsAppForced } = require('./whatsapp');
const { ESCALATION_KEYWORDS, MADDY_PHONE } = require('./constants');
const { maskPhone } = require('./market');

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function createEscalation(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody,
  });

  const masked = maskPhone(phone);
  const alert = `ESCALATION ALERT\nFrom: ${masked}\nReason: ${reason}\nMessage: "${messageBody?.slice(0, 200) || 'N/A'}"`;

  await sendWhatsAppForced(MADDY_PHONE, alert, null);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!checkins) return;

  const weekNums = checkins.map((c) => c.week_no);
  const startDate = new Date(client.program_started_at);
  const weeksElapsed = Math.floor((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

  let consecutiveMissed = 0;
  for (let w = weeksElapsed; w > Math.max(0, weeksElapsed - 3); w--) {
    if (!weekNums.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || maskPhone(client.phone)} has missed ${consecutiveMissed} check-ins.`,
      clientId
    );
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
