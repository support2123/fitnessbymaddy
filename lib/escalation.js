const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

async function escalateToMaddy(reason, context = {}) {
  const phone = context.clientPhone || context.leadPhone || 'unknown';
  const name = context.name || 'Unknown';
  const message = `ESCALATION: ${reason}\nClient: ${name} (${maskPhone(phone)})\n${context.details || ''}`;

  console.warn(`[ESCALATION] ${reason} for ${maskPhone(phone)}`);

  try {
    await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
      reason,
      name,
      context.details || 'No additional details'
    ]);
  } catch (err) {
    console.error('Failed to send escalation to Maddy:', err.message);
  }

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy };
