const { sendWhatsApp, maskPhone } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy(reason, details) {
  console.log(`ESCALATION: ${reason} — ${JSON.stringify(details)}`);

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    details.phone ? maskPhone(details.phone) : 'N/A',
    details.summary || 'See admin dashboard for details',
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
        <p><strong>Phone:</strong> ${details.phone ? maskPhone(details.phone) : 'N/A'}</p>
        <p><strong>Details:</strong> ${details.summary || 'N/A'}</p>
        <p><strong>Message:</strong> ${details.message || 'N/A'}</p>
        <p><em>Check the admin dashboard for full details.</em></p>
      `,
    });
  } catch (err) {
    console.error('Email escalation failed:', err.message);
  }
}

module.exports = { escalateToMaddy };
