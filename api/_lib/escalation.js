const supabase = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'bulimia',
  'anorexia', 'purging', 'faint', 'fainting'
];

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

function checkEscalation(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  await sendWhatsApp(
    MADDY_PHONE,
    `ESCALATION ALERT\nFrom: ${masked}\nReason: ${reason}\nMessage: "${(messageBody || '').slice(0, 200)}"`,
    null,
    true
  );
}

async function checkConsecutiveMissedCheckins(clientId) {
  const { data } = await supabase
    .from('clients')
    .select('phone, name')
    .eq('id', clientId)
    .single();

  if (!data) return;

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: programs } = await supabase
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (!programs || programs.length === 0) return;

  const currentWeek = programs[0].week_no;
  const submittedWeeks = (checkins || []).map(c => c.week_no);

  if (currentWeek >= 2 &&
      !submittedWeeks.includes(currentWeek) &&
      !submittedWeeks.includes(currentWeek - 1)) {
    await escalate(
      data.phone,
      '2 consecutive missed check-ins',
      `Client ${data.name || 'unknown'} missed weeks ${currentWeek - 1} and ${currentWeek}`
    );
  }
}

module.exports = { checkEscalation, escalate, checkConsecutiveMissedCheckins };
