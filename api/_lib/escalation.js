const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'not eating', 'faint', 'fainting'
];

function needsEscalation(message) {
  const lower = (message || '').toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

async function createEscalation({ phone, clientId, reason, triggerMessage }) {
  const supabase = getSupabase();

  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    body: `ESCALATION: ${reason}\nFrom: ${phone}\nMessage: "${(triggerMessage || '').slice(0, 200)}"`
  });
}

async function checkMissedCheckins(clientId, phone) {
  const supabase = getSupabase();
  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const startDate = new Date(client.program_started_at);
  const weeksSinceStart = Math.floor(
    (Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  const submittedWeeks = (checkins || []).map(c => c.week_no);
  let consecutiveMissed = 0;

  for (let w = weeksSinceStart; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) {
      consecutiveMissed++;
    } else {
      break;
    }
  }

  if (consecutiveMissed >= 2) {
    await createEscalation({
      phone,
      clientId,
      reason: '2 consecutive missed check-ins',
      triggerMessage: `Client missed weeks ${weeksSinceStart - 1} and ${weeksSinceStart}`
    });
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
