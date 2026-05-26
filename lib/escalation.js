const supabase = require('./supabase');
const { maskPhone } = require('./market');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'medical condition',
  'not eating', 'fainting', 'chest pain', 'heart', 'surgery'
];

const MADDY_PHONE = '+917082478374';

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function getEscalationReason(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw));
}

async function notifyMaddy(phone, message, reason) {
  const masked = maskPhone(phone);
  const body = `ESCALATION from ${masked}: "${message.slice(0, 200)}"\nReason: ${reason}`;

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body,
    template_name: 'escalation_alert',
    status: 'pending'
  });

  await sendEscalationWhatsApp(MADDY_PHONE, masked, message.slice(0, 200), reason);
}

async function sendEscalationWhatsApp(to, maskedFrom, messagePreview, reason) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return;

  try {
    await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        campaignName: 'escalation_alert',
        destination: to.replace('+', ''),
        userName: 'System',
        templateParams: [maskedFrom, reason, messagePreview],
        source: 'automation'
      })
    });
  } catch (err) {
    console.error('Escalation send failed:', err.message);
  }
}

async function checkConsecutiveMissedCheckins(clientId) {
  const { data } = await supabase
    .from('clients')
    .select('phone, name, program')
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
    await notifyMaddy(
      data.phone,
      `Client ${data.name || maskPhone(data.phone)} (${data.program}) missed 2 consecutive check-ins (weeks ${currentWeek - 1} and ${currentWeek}).`,
      '2 consecutive missed check-ins'
    );
  }
}

module.exports = {
  needsEscalation,
  getEscalationReason,
  notifyMaddy,
  checkConsecutiveMissedCheckins
};
