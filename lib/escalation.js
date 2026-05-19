const { sendTextMessage } = require('./whatsapp');

const MADDY_PHONE = '917082478374';

async function notifyMaddy(reason, details) {
  const message = [
    '🚨 *Escalation Alert*',
    '',
    `*Reason:* ${reason}`,
    `*Details:* ${details}`,
    '',
    'Please review and respond.',
  ].join('\n');

  return sendTextMessage(MADDY_PHONE, message);
}

async function logMessage(supabase, phone, direction, body, templateName) {
  return supabase.from('messages').insert({
    phone,
    direction,
    body: body || null,
    template_name: templateName || null,
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

module.exports = { notifyMaddy, logMessage };
