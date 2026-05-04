const { supabase } = require('./supabase');
const { sendText } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'hospital',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody,
  });

  const maddyPhone = process.env.MADDY_PHONE;
  if (maddyPhone) {
    await sendText(
      maddyPhone,
      `🚨 ESCALATION\nFrom: ${phone}\nReason: ${reason}\nMsg: ${messageBody ? messageBody.slice(0, 200) : 'N/A'}`
    );
  }
}

async function checkMissedCheckins(clientId, phone) {
  const { data: recent } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!recent || recent.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const missedConsecutive = weeksElapsed - (recent.length > 0 ? recent[0].week_no : 0);
  if (missedConsecutive >= 2) {
    await escalate(phone, '2 consecutive missed check-ins', null);
  }
}

module.exports = { needsEscalation, escalate, checkMissedCheckins };
