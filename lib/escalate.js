const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const safeDetails = { ...details };
  if (safeDetails.phone) {
    safeDetails.phone = maskPhone(safeDetails.phone);
  }

  const message = [
    `ESCALATION: ${reason}`,
    `Details: ${JSON.stringify(safeDetails, null, 2)}`,
  ].join('\n');

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    JSON.stringify(safeDetails),
  ]);

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
