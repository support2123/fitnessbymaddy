const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./mask-phone');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'not eating', 'binge'
];

function needsEscalation(messageText) {
  if (!messageText) return { escalate: false };
  const lower = messageText.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }
  return { escalate: false };
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION ALERT\n\n` +
    `Reason: ${reason}\n` +
    `Phone: ${maskPhone(context.phone)}\n` +
    `Name: ${context.name || 'Unknown'}\n` +
    `Message: ${context.message || 'N/A'}\n\n` +
    `Action required - please review.`;

  await sendWhatsApp(MADDY_PHONE, msg, 'escalation_alert');
}

async function checkMissedCheckins(clientId, db) {
  const { data } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length < 2) return false;

  const weekNos = data.map(c => c.week_no);
  const latest = Math.max(...weekNos);
  const expected = [latest, latest - 1];
  const submitted = new Set(weekNos);

  let consecutive = 0;
  for (const w of expected) {
    if (!submitted.has(w)) consecutive++;
  }

  return consecutive >= 2;
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
