const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: message.slice(0, 500),
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const welcomeParams = market === 'IN'
        ? { templateParams: [name || 'there'] }
        : { templateParams: [name || 'there'] };

      await sendWhatsApp(phone, 'welcome_v1', { name, ...welcomeParams });
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const qualification = qualifyLead(message);
    if (qualification) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: qualification.program
        })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgTemplate = market === 'IN' ? 'qualified_reply_hi' : 'qualified_reply_en';
      await sendWhatsApp(phone, msgTemplate, {
        name: existingLead.name || 'there',
        templateParams: [
          existingLead.name || 'there',
          qualification.name,
          qualification.price,
          checkoutUrl,
          intakeUrl
        ]
      }, true);

      return res.status(200).json({ action: 'qualified', program: qualification.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
