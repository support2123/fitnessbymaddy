const { sendText } = require('./whatsapp');
const { supabase } = require('./supabase');

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'not eating',
  'medical condition', 'surgery', 'doctor said',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION ALERT\nReason: ${reason}\nContext: ${context}`;
  await sendText(MADDY_PHONE, msg);
}

async function checkMissedCheckins(clientId) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.ceil(
    (Date.now() - new Date(client.program_started_at).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
  const expectedCheckins = weeksActive;
  const actualCheckins = data.length;

  if (expectedCheckins - actualCheckins >= 2) {
    await escalateToMaddy(
      '2 consecutive missed check-ins',
      `Client: ${client.name} (${client.phone}), Program: ${client.program}`
    );
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
