import supabase from './supabase.js';
import { sendText, maskPhone } from './whatsapp.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorexia', 'bulimia',
  'heart', 'surgery', 'hospital', 'doctor said',
];

export function shouldEscalate(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export async function escalate(phone, triggerType, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    trigger_type: triggerType,
    message_body: messageBody,
  });

  const masked = maskPhone(phone);
  const alert = `⚠️ ESCALATION: ${triggerType}\nFrom: ${masked}\nMessage: "${(messageBody || '').slice(0, 200)}"\n\nPlease review in the admin dashboard.`;

  await sendText(MADDY_PHONE, alert);
}

export async function checkMissedCheckins(clientId, phone) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return;

  const { data: client } = await supabase
    .from('clients')
    .select('program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const latestCheckin = data[0]?.week_no || 0;
  const missedConsecutive = weeksElapsed - latestCheckin;

  if (missedConsecutive >= 2) {
    await escalate(phone, '2_consecutive_missed_checkins', `Client missed ${missedConsecutive} consecutive check-ins`);
  }
}
