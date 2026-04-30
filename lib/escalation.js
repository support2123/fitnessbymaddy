const { sendText, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart',
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

async function escalateToMaddy({ phone, reason, messageText }) {
  const alert = `ESCALATION ALERT\nFrom: ${maskPhone(phone)}\nReason: ${reason}\nMessage: "${messageText}"\n\nPlease review and respond manually.`;

  await sendText(MADDY_PHONE, alert);

  const db = getSupabase();
  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: alert,
    template_name: 'escalation_alert',
  });
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
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const weekNos = checkins.map(c => c.week_no).sort((a, b) => b - a);
  if (weekNos.length >= 2) {
    const latest = weekNos[0];
    const prev = weekNos[1];
    if (latest - prev > 2) {
      await escalateToMaddy({
        phone: client.phone,
        reason: '2 consecutive missed check-ins',
        messageText: `Client ${client.name} has missed 2+ consecutive check-ins (last: week ${latest}, before: week ${prev})`,
      });
    }
  }
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
