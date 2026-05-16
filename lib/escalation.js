const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, context = {}) {
  const lines = [
    `ESCALATION: ${reason}`,
    context.clientName ? `Client: ${context.clientName}` : '',
    context.phone ? `Phone: ${maskPhone(context.phone)}` : '',
    context.message ? `Message: "${context.message.slice(0, 200)}"` : '',
    context.details || ''
  ].filter(Boolean);

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, lines.join('\n')]
  });

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
