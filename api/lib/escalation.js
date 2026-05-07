import { sendTemplate } from './whatsapp.js';
import { supabase } from './supabase.js';

const MADDY_PHONE = '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizziness', 'dizzy', 'eating disorder', 'binge', 'purge',
];

export function needsEscalation(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function escalateToMaddy(phone, reason, context) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    phone,
    context.slice(0, 200),
  ]);
  await supabase.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `ESCALATION: ${reason} from ${phone}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}
