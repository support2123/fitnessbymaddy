const { sendWhatsApp, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'bulimi', 'anorexi', 'purging',
  'medical condition', 'doctor said', 'hospitali'
];

function needsEscalation(message) {
  if (!message) return { needed: false };
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { needed: true, trigger: kw };
    }
  }
  return { needed: false };
}

async function escalateToMaddy(reason, context) {
  const db = getSupabase();

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `ESCALATION: ${reason} — ${context.phone ? maskPhone(context.phone) : 'unknown'}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'pending'
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    templateParams: [
      reason,
      context.clientName || 'Unknown',
      context.details || 'No details'
    ]
  });
}

async function checkMissedCheckins() {
  const db = getSupabase();

  const { data: activeClients } = await db
    .from('clients')
    .select('id, phone, name')
    .eq('status', 'active');

  if (!activeClients) return;

  for (const client of activeClients) {
    const { data: checkins } = await db
      .from('checkins')
      .select('id, week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (!checkins || checkins.length === 0) continue;

    const weeksSinceStart = Math.floor(
      (Date.now() - new Date(client.program_started_at).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );

    const latestCheckinWeek = checkins[0]?.week_no || 0;
    const missedWeeks = weeksSinceStart - latestCheckinWeek;

    if (missedWeeks >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        clientName: client.name,
        details: `Last check-in: week ${latestCheckinWeek}, current week: ${weeksSinceStart}`
      });
    }
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
