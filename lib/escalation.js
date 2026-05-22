const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

const ESCALATION_TRIGGERS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'vomit',
  'faint', 'chest pain', 'heart',
];

function shouldEscalate(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_TRIGGERS.some(trigger => lower.includes(trigger));
}

async function escalateToMaddy({ reason, phone, details }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION ALERT\n\nReason: ${reason}\nLead/Client: ${masked}\nDetails: ${details || 'N/A'}\n\nPlease review in admin dashboard.`;

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    params: [reason, masked],
  });
}

async function checkMissedCheckins(db) {
  const { data: clients } = await db
    .from('clients')
    .select('id, phone, name, program, program_started_at')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const weeksIn = Math.floor(
      (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
    );

    const { data: checkins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) continue;

    const lastWeek = checkins[0]?.week_no || 0;
    const missedWeeks = weeksIn - lastWeek;

    if (missedWeeks >= 2) {
      await escalateToMaddy({
        reason: '2 consecutive missed check-ins',
        phone: client.phone,
        details: `${client.name || 'Unknown'} — ${client.program} — last check-in was week ${lastWeek}, currently week ${weeksIn}`,
      });
    }
  }
}

module.exports = { shouldEscalate, escalateToMaddy, checkMissedCheckins };
