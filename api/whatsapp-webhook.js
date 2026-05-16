const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logIncoming } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, needsEscalation, isOptOut, jsonResponse } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await logIncoming(phone, message);

    const supabase = getSupabase();

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await sendWhatsApp(process.env.MADDY_PHONE, 'escalation_alert', {
        templateParams: [phone, message.slice(0, 200)]
      });
      return res.status(200).json({ action: 'escalated' });
    }

    const existingLead = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead.data) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const template = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
      await sendWhatsApp(phone, template, {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    const lead = existingLead.data;

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    const existingClient = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient.data) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const intent = classifyIntent(message);
    if (intent) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: intent.program })
        .eq('phone', phone);

      const market = lead.market || detectMarket(phone);
      const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
      const intakeBase = 'https://fitnessbymaddy.com/intake.html';

      await sendWhatsApp(phone, 'program_offer', {
        templateParams: [
          senderName || lead.name || 'there',
          intent.name,
          `${checkoutBase}/${intent.program}`,
          `${intakeBase}?lead=${lead.id}`
        ]
      });

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
