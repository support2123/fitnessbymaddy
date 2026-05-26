const { sendTemplate, maskPhone } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '+917082478374';

async function notifyMaddy(reason, details) {
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    details.clientName || 'Unknown',
    maskPhone(details.phone),
    details.message || 'No details'
  ]);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[ESCALATION] ${reason}`,
      html: `
        <h2>Escalation Alert</h2>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><strong>Client:</strong> ${details.clientName || 'Unknown'}</p>
        <p><strong>Phone:</strong> ${maskPhone(details.phone)}</p>
        <p><strong>Message:</strong> ${details.message || 'N/A'}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
      `
    });
  } catch (e) {
    console.error('Email escalation failed:', e.message);
  }
}

module.exports = { notifyMaddy };
