const { sendText } = require('./whatsapp');
const { MADDY_PHONE } = require('./utils');
const { Resend } = require('resend');

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION\nReason: ${reason}\n${details}\nTime: ${new Date().toISOString()}`;

  await sendText(MADDY_PHONE, msg);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `Escalation: ${reason}`,
      text: msg,
    });
  } catch (_) {
    // email is best-effort
  }
}

module.exports = { escalateToMaddy };
