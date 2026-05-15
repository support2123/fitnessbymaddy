const { sendText, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `🚨 ESCALATION NEEDED\n\nReason: ${reason}\nClient: ${masked}\nContext: ${context || 'N/A'}\n\nPlease review and respond manually.`;

  await sendText(MADDY_PHONE, msg);

  const supabase = getSupabase();
  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
  });
}

async function checkMissedCheckins(clientId) {
  const supabase = getSupabase();
  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length === 0) return;

  const { data: latestProgram } = await supabase
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1)
    .single();

  if (!latestProgram) return;

  const expectedWeek = latestProgram.week_no;
  const submittedWeeks = checkins.map(c => c.week_no);

  const missed = [expectedWeek, expectedWeek - 1].filter(
    w => w > 0 && !submittedWeeks.includes(w)
  );

  if (missed.length >= 2) {
    await escalateToMaddy(
      '2 consecutive missed check-ins',
      client.phone,
      `${client.name || 'Unknown'} — ${client.program}`
    );
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
