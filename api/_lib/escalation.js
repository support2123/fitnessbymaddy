const { sendWhatsApp, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'purging', 'medical', 'surgery', 'doctor said'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function escalateToMaddy({ reason, phone, clientName, message }) {
  const db = getSupabase();

  const alert = `ESCALATION ALERT\nReason: ${reason}\nClient: ${clientName || 'Unknown'}\nPhone: ${maskPhone(phone)}\nMessage: "${message || 'N/A'}"`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: alert,
    params: [reason, clientName || 'Unknown']
  });

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: alert,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

async function checkMissedCheckins(clientId) {
  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('name, phone, program')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const { data: checkins } = await db
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!checkins || checkins.length < 2) return;

  const latest = checkins[0].week_no;
  const previous = checkins[1].week_no;

  if (latest - previous >= 3) {
    await escalateToMaddy({
      reason: '2 consecutive missed check-ins',
      phone: client.phone,
      clientName: client.name,
      message: `Last check-in was week ${latest}, previous was week ${previous}`
    });
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins, ESCALATION_KEYWORDS };
