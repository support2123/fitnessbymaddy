const { supabase } = require('./supabase');
const { sendWhatsAppText } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'vomiting', 'chest pain', 'heart'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

function checkEscalation(message) {
  const lower = (message || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

async function createEscalation({ phone, clientId, leadId, reason, triggerMessage }) {
  const { error } = await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    lead_id: leadId || null,
    reason,
    trigger_message: triggerMessage
  });
  if (error) console.error('Escalation insert error:', error.message);

  const masked = maskPhone(phone);
  await sendWhatsAppText(
    MADDY_PHONE,
    `ESCALATION: ${reason}\nFrom: ${masked}\nMessage: "${(triggerMessage || '').slice(0, 100)}"\n\nCheck admin dashboard for details.`
  );
}

async function checkMissedCheckins(clientId) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const submittedWeeks = data.map(d => d.week_no);
  let consecutiveMissed = 0;
  for (let w = weeksActive; w > 0 && consecutiveMissed < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutiveMissed++;
    else break;
  }

  if (consecutiveMissed >= 2) {
    await createEscalation({
      phone: client.phone,
      clientId,
      reason: '2 consecutive missed check-ins',
      triggerMessage: `Client has missed ${consecutiveMissed} consecutive weekly check-ins`
    });
  }
}

module.exports = { checkEscalation, createEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
