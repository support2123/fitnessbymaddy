const { supabase } = require('./supabase');
const { sendTextMessage } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function escalateToMaddy(phone, reason, messageBody, clientId) {
  await supabase().from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  const alert = `ESCALATION ALERT\nFrom: ${masked}\nReason: ${reason}\nMessage: "${messageBody?.slice(0, 200) || 'N/A'}"`;
  await sendTextMessage(MADDY_PHONE, alert);
}

async function checkMissedCheckins(clientId, phone) {
  const { data: recent } = await supabase()
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  if (!recent || recent.length === 0) return;

  const { data: client } = await supabase()
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = recent.map(c => c.week_no);
  let consecutive = 0;
  for (let w = weeksElapsed; w > 0 && consecutive < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutive++;
    else break;
  }

  if (consecutive >= 2) {
    await escalateToMaddy(phone, '2 consecutive missed check-ins', null, clientId);
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
