const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'not eating', 'starving', 'vomiting',
];

function needsEscalation(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation(phone, reason, triggerMessage, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage,
  });

  const masked = phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    triggerMessage ? triggerMessage.slice(0, 100) : 'N/A',
  ]);
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  const submittedWeeks = new Set((checkins || []).map(c => c.week_no));
  let consecutiveMissed = 0;

  for (let w = weeksElapsed; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.has(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await createEscalation(
      client.phone,
      '2 consecutive missed check-ins',
      `Client ${client.name || 'unknown'} missed weeks ${weeksElapsed - 1} and ${weeksElapsed}`,
      clientId
    );
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
