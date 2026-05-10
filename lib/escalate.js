const { sendTemplate } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalateToMaddy(reason, details, { supabase }) {
  const text = `ESCALATION: ${reason}\n${JSON.stringify(details, null, 2)}`;

  await supabase.from('messages').insert({
    phone: 'SYSTEM',
    direction: 'out',
    body: text.substring(0, 500),
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'escalation',
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details.phone || 'unknown'], { supabase });
}

module.exports = { escalateToMaddy };
