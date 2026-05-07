import { sendTemplate } from './whatsapp.js';
import supabase from './supabase.js';

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medical',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia',
  'bulimia', 'purging', 'fainting'
];

export function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe';
}

export async function escalateToMaddy(phone, reason, context) {
  const maskedPhone = phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
  const msg = `ESCALATION: ${reason}\nFrom: ${maskedPhone}\nContext: ${context}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, maskedPhone, context.slice(0, 200)]);

  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: msg,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

export async function checkMissedCheckins(clientId) {
  const { data } = await supabase
    .from('checkins')
    .select('week_no')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return false;

  const { data: client } = await supabase
    .from('clients')
    .select('phone, name, program_started_at')
    .eq('id', clientId)
    .single();

  if (!client) return false;

  const weeksElapsed = Math.floor(
    (Date.now() - new Date(client.program_started_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const lastCheckin = data[0].week_no;
  const missed = weeksElapsed - lastCheckin;

  if (missed >= 2) {
    await escalateToMaddy(
      client.phone,
      '2 consecutive missed check-ins',
      `Client: ${client.name || 'Unknown'}, last check-in: week ${lastCheckin}, current week: ${weeksElapsed}`
    );
    return true;
  }

  return false;
}
