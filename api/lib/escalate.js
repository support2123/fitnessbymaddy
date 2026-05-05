const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, context = {}) {
  const masked = context.phone ? maskPhone(context.phone) : 'unknown';
  const params = [
    reason,
    masked,
    context.message || 'No message',
    new Date().toISOString().slice(0, 16)
  ];

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', params);

  console.log(`[ESCALATION] ${reason} | Phone: ${masked}`);
}

module.exports = { escalateToMaddy };
