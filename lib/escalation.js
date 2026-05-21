const { notifyMaddy, maskPhone } = require('./whatsapp');

async function escalate(reason, phone, details) {
  const masked = maskPhone(phone);
  const msg = [
    `Reason: ${reason}`,
    `Lead/Client: ${masked}`,
    details ? `Details: ${details}` : ''
  ].filter(Boolean).join('\n');

  await notifyMaddy(`ESCALATION: ${reason}`, msg);
  return { escalated: true, reason };
}

module.exports = { escalate };
