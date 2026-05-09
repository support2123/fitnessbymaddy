import { sendWhatsApp } from './whatsapp.js';
import { maskPhone } from './helpers.js';

const MADDY_PHONE = '+917082478374';

export async function escalateToMaddy(reason, context = {}) {
  const msg = [
    `ESCALATION: ${reason}`,
    context.phone ? `Client: ${maskPhone(context.phone)}` : '',
    context.name ? `Name: ${context.name}` : '',
    context.details || ''
  ].filter(Boolean).join('\n');

  console.log(`Escalation triggered: ${reason}`);

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    context.phone ? maskPhone(context.phone) : 'Unknown',
    context.details || 'No additional details'
  ]);

  return { escalated: true, reason };
}
