const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalateToMaddy(reason, details = {}) {
  const msg = [
    `🚨 ESCALATION: ${reason}`,
    details.phone ? `Phone: ${maskPhone(details.phone)}` : '',
    details.name ? `Name: ${details.name}` : '',
    details.program ? `Program: ${details.program}` : '',
    details.message ? `Message: "${details.message.slice(0, 200)}"` : '',
    details.extra || '',
  ].filter(Boolean).join('\n');

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [msg]);

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy };
