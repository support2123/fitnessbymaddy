const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [
      reason,
      details.clientName || 'Unknown',
      details.phone || 'N/A',
      details.message || ''
    ]
  });

  console.log(`ESCALATION [${reason}]: ${details.clientName || 'Unknown'}`);
}

module.exports = { escalateToMaddy };
