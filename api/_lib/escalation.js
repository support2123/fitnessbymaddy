const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone || 'unknown',
    context.name || 'unknown',
    (context.message || '').slice(0, 200),
  ]);
}

async function checkMissedCheckins(supabase) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, phone, name, program_started_at')
    .eq('status', 'active');

  if (!clients) return;

  for (const client of clients) {
    const weeksSinceStart = Math.floor(
      (Date.now() - new Date(client.program_started_at).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
    );

    const { count } = await supabase
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('week_no', weeksSinceStart - 1);

    if (count === 0 && weeksSinceStart >= 2) {
      await escalateToMaddy('2 consecutive missed check-ins', {
        phone: client.phone,
        name: client.name,
        message: `Client has missed check-ins for weeks ${weeksSinceStart - 1} and ${weeksSinceStart}`,
      });
    }
  }
}

module.exports = { needsEscalation, escalateToMaddy, checkMissedCheckins };
