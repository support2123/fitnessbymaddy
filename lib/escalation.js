const { Resend } = require('resend');
const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { formatIST } = require('./utils');

async function notifyMaddy(reason, details, { leadId, clientId } = {}) {
  const timestamp = formatIST(new Date());

  await supabase.from('escalations').insert({
    lead_id: leadId || null,
    client_id: clientId || null,
    reason,
    details,
    status: 'pending'
  });

  const whatsappResult = await sendTemplate(
    process.env.MADDY_PHONE,
    'escalation_alert',
    [reason, details, timestamp]
  );

  const resend = new Resend(process.env.RESEND_API_KEY);

  const emailResult = await resend.emails.send({
    from: 'support@fitnessbymaddy.com',
    to: process.env.MADDY_EMAIL,
    subject: `[ESCALATION] ${reason}`,
    text: `Reason: ${reason}\n\nDetails:\n${details}\n\nTimestamp: ${timestamp}`
  });

  return {
    whatsapp: whatsappResult,
    email: emailResult
  };
}

module.exports = { notifyMaddy };
