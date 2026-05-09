const { sendTextMessage, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const msg = `🚨 ESCALATION ALERT\n\nReason: ${reason}\n\n${details}\n\nPlease review and respond.`;
  console.log(`Escalating to Maddy: ${reason}`);
  return sendTextMessage(MADDY_PHONE, msg, true);
}

module.exports = { escalateToMaddy, MADDY_PHONE };
