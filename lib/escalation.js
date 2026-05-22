const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation({ phone, clientId, reason, messageBody }) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [reason, phone],
    body: `ESCALATION: ${reason}\nFrom: ${phone}\nMessage: ${messageBody || 'N/A'}`
  });
}

async function checkMissedCheckins(clientId, phone) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const startDate = new Date(client.program_started_at);
  const now = new Date();
  const weeksElapsed = Math.floor((now - startDate) / (7 * 24 * 60 * 60 * 1000));

  const submittedWeeks = checkins ? checkins.map(c => c.week_no) : [];
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
      phone,
      clientId,
      reason: '2 consecutive missed check-ins',
      messageBody: `Client has missed ${consecutiveMissed} consecutive weekly check-ins`
    });
  }
}

module.exports = { needsEscalation, createEscalation, checkMissedCheckins };
