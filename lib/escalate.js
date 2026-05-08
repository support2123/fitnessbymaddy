const { sendText } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

async function notifyMaddy(reason, details) {
  const msg = `ESCALATION ALERT\n\nReason: ${reason}\n${details}\n\nPlease review and respond.`;
  await sendText(MADDY_PHONE, msg);
}

async function escalateLeadIssue(phone, message) {
  await notifyMaddy('Lead flagged for review', `Phone: ${maskPhone(phone)}\nMessage: "${message}"`);
}

async function escalateClientIssue(clientName, phone, issue) {
  await notifyMaddy('Client issue detected', `Client: ${clientName}\nPhone: ${maskPhone(phone)}\nIssue: ${issue}`);
}

async function escalateMissedCheckins(clientName, phone, missedCount) {
  await notifyMaddy(`${missedCount} consecutive missed check-ins`, `Client: ${clientName}\nPhone: ${maskPhone(phone)}`);
}

async function escalatePaymentFailure(clientName, phone) {
  await notifyMaddy('Payment failure for active client', `Client: ${clientName}\nPhone: ${maskPhone(phone)}`);
}

module.exports = { notifyMaddy, escalateLeadIssue, escalateClientIssue, escalateMissedCheckins, escalatePaymentFailure };
