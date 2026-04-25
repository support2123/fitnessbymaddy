import { sendClientMessage } from './whatsapp.js';
import { maskPhone } from './whatsapp.js';

const MADDY_PHONE = '+917082478374';

export async function escalateToMaddy(reason, details) {
  const msg = [
    `ESCALATION: ${reason}`,
    details.clientName ? `Client: ${details.clientName}` : '',
    details.phone ? `Phone: ${maskPhone(details.phone)}` : '',
    details.message ? `Message: ${details.message.slice(0, 200)}` : '',
    details.extra || ''
  ].filter(Boolean).join('\n');

  console.log(`[ESCALATION] ${reason} — ${details.phone ? maskPhone(details.phone) : 'unknown'}`);

  return sendClientMessage(MADDY_PHONE, 'escalation_alert', [
    reason,
    details.clientName || 'Unknown',
    details.message ? details.message.slice(0, 100) : 'No details'
  ]);
}
