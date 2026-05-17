const { sendText } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '917082478374';

async function notifyMaddy(subject, details) {
  const msg = `ALERT: ${subject}\n\n${details}\n\nPlease review and take action.`;
  await sendText(MADDY_PHONE, msg, true);
}

async function escalateLead(phone, reason, messageBody) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    'Lead Escalation',
    `Phone: ${masked}\nReason: ${reason}\nMessage: "${messageBody}"`
  );
}

async function escalateClient(clientName, phone, reason, details) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    'Client Escalation',
    `Client: ${clientName}\nPhone: ${masked}\nReason: ${reason}\nDetails: ${details}`
  );
}

async function escalateMissedCheckins(clientName, phone, missedCount) {
  const masked = maskPhone(phone);
  await notifyMaddy(
    'Missed Check-ins',
    `Client: ${clientName}\nPhone: ${masked}\n${missedCount} consecutive check-ins missed.`
  );
}

module.exports = { notifyMaddy, escalateLead, escalateClient, escalateMissedCheckins };
