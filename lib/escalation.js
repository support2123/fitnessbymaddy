const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalateToMaddy(reason, context) {
  const safePhone = context.phone ? maskPhone(context.phone) : 'unknown';
  const params = [
    reason,
    context.name || 'Unknown',
    safePhone,
    context.message || 'N/A',
  ];

  console.log(`ESCALATION: ${reason} for ${safePhone}`);

  try {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', params);
  } catch (err) {
    console.error('Failed to send escalation to Maddy:', err.message);
  }
}

module.exports = { escalateToMaddy };
