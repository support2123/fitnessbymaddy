const { sendTemplate, maskPhone } = require('./whatsapp');
const { supabase } = require('./supabase');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex',
  'bulimi', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy(reason, phone, context) {
  const masked = maskPhone(phone);
  const msg = `ESCALATION: ${reason}\nLead/Client: ${masked}\nContext: ${context}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, masked, context.slice(0, 100)]);

  console.log(`[ESCALATION] ${reason} for ${masked}`);
}

async function checkMissedCheckins(clientId) {
  const { data: checkins } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length < 2) return;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: latestProgram } = await supabase
    .from('programs')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(1);

  if (latestProgram && latestProgram.length > 0) {
    const currentWeek = latestProgram[0].week_no;
    const submittedWeeks = checkins.map(c => c.week_no);
    const missedConsecutive = !submittedWeeks.includes(currentWeek) && !submittedWeeks.includes(currentWeek - 1);

    if (missedConsecutive) {
      await escalateToMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `${client.name || 'Unknown'} on ${client.program}`
      );
    }
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
