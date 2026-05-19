const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy(reason, context) {
  const msg =
    `[ESCALATION] ${reason}\n` +
    `Phone: ${maskPhone(context.phone)}\n` +
    `Name: ${context.name || 'Unknown'}\n` +
    `Message: ${(context.message || '').slice(0, 200)}\n` +
    `Time: ${new Date().toISOString()}`;

  await sendWhatsApp(MADDY_PHONE, msg, 'escalation_alert');
  return { escalated: true, reason };
}

module.exports = { escalateToMaddy };
