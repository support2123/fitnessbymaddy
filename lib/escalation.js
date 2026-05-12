const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purging', 'not eating',
];

function shouldEscalate(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function createEscalation(sourceType, sourceId, phone, reason, excerpt) {
  const sb = getSupabase();

  await sb.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone: phone || null,
    reason,
    message_excerpt: excerpt ? excerpt.slice(0, 500) : null,
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone || 'Unknown',
    excerpt ? excerpt.slice(0, 200) : 'No details',
  ]);
}

async function checkMissedCheckins(clientId, phone) {
  const sb = getSupabase();
  const { data: client } = await sb
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksActive = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const { data: checkins } = await sb
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(3);

  const submittedWeeks = (checkins || []).map(c => c.week_no);
  let consecutive = 0;
  for (let w = weeksActive; w > 0 && consecutive < 2; w--) {
    if (!submittedWeeks.includes(w)) consecutive++;
    else break;
  }

  if (consecutive >= 2) {
    await createEscalation('client', clientId, phone, '2 consecutive missed check-ins', `Client has missed ${consecutive} consecutive weekly check-ins`);
  }
}

module.exports = { shouldEscalate, createEscalation, checkMissedCheckins, ESCALATION_KEYWORDS };
