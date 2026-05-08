const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex',
  'bulimi', 'vomit', 'faint', 'chest pain', 'heart'
];

async function checkEscalation(phone, messageBody) {
  if (!messageBody) return false;

  const lower = messageBody.toLowerCase();
  const triggered = ESCALATION_KEYWORDS.find(kw => lower.includes(kw));

  if (!triggered) return false;

  await supabase.from('escalations').insert({
    phone,
    reason: `Keyword detected: "${triggered}"`,
    message_body: messageBody
  });

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    params: [phone.slice(-4), triggered, messageBody.slice(0, 100)]
  });

  return true;
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
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const completedWeeks = checkins ? checkins.map(c => c.week_no) : [];
  let missed = 0;
  for (let w = weeksElapsed; w > Math.max(0, weeksElapsed - 2); w--) {
    if (!completedWeeks.includes(w)) missed++;
  }

  if (missed >= 2) {
    await supabase.from('escalations').insert({
      phone,
      reason: '2 consecutive missed check-ins',
      message_body: `Client has missed ${missed} recent check-ins (weeks ${weeksElapsed - 1}-${weeksElapsed})`
    });

    await sendWhatsApp({
      phone: MADDY_PHONE,
      templateName: 'escalation_alert',
      params: [phone.slice(-4), 'missed_checkins', `${missed} missed check-ins`]
    });
  }
}

module.exports = { checkEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
