const { sendTemplate } = require('./whatsapp');
const { Resend } = require('resend');
const { maskPhone } = require('./market');

const MADDY_PHONE = '917082478374';

async function notifyMaddy(subject, details) {
  await sendTemplate(MADDY_PHONE, 'admin_alert', [subject, details], true);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[Alert] ${subject}`,
      text: details,
    });
  } catch (_) {
    // email is best-effort
  }
}

function buildEscalationDetails(phone, message, reason) {
  return `Phone: ${maskPhone(phone)}\nMessage: "${message}"\nReason: ${reason}\nTime: ${new Date().toISOString()}`;
}

module.exports = { notifyMaddy, buildEscalationDetails };
