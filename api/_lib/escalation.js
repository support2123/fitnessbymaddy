const { sendTemplate } = require('./whatsapp');

async function notifyMaddy(reason, context = {}) {
  const maddyPhone = process.env.MADDY_PHONE || '917082478374';
  const summary = [
    `ESCALATION: ${reason}`,
    context.clientName ? `Client: ${context.clientName}` : null,
    context.phone ? `Phone: ...${context.phone.slice(-4)}` : null,
    context.message ? `Msg: "${context.message.substring(0, 100)}"` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await sendTemplate(maddyPhone, 'escalation_alert', [summary]);
  } catch (_) {
    console.error('[escalation] Failed to notify Maddy:', reason);
  }
}

module.exports = { notifyMaddy };
