const { sendText } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

async function escalateToMaddy(reason, leadOrClient, messageBody) {
  const name = leadOrClient.name || 'Unknown';
  const phone = maskPhone(leadOrClient.phone);

  const alert = [
    `ESCALATION: ${reason}`,
    `Client: ${name} (${phone})`,
    messageBody ? `Message: "${messageBody.slice(0, 200)}"` : '',
    `Action needed — check admin dashboard.`
  ].filter(Boolean).join('\n');

  await sendText(MADDY_PHONE, alert, true);
  return { escalated: true, reason };
}

module.exports = { escalateToMaddy };
