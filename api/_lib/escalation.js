const { sendClientMessage, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const db = getSupabase();
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nName: ${context.name || 'Unknown'}\nMessage: ${(context.message || '').slice(0, 200)}`;

  await sendClientMessage(MADDY_PHONE, 'escalation_alert', [reason, context.name || 'Unknown']);

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    status: 'sent'
  });

  return { escalated: true, reason };
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('*, checkins(week_no)')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));
  const completedWeeks = client.checkins ? client.checkins.length : 0;
  const missedConsecutive = weeksElapsed - completedWeeks;

  if (missedConsecutive >= 2) {
    await escalateToMaddy('2 consecutive missed check-ins', {
      phone: client.phone,
      name: client.name,
      message: `Client has missed ${missedConsecutive} consecutive check-ins. Program: ${client.program}`
    });
    return true;
  }
  return false;
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
