const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, detectProgram, getProgramDetails, needsEscalation, isOptOut } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone,
        clientName: senderName,
        message
      });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'client_message_logged', clientId: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.json({ action: 'lead_dropped_ignored' });
      }

      const program = detectProgram(message);
      if (program) {
        const details = getProgramDetails(program);
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        await sendWhatsApp(phone, 'program_info', {
          name: senderName || existingLead.name || 'there',
          templateParams: [
            senderName || existingLead.name || 'there',
            details.name,
            `$${details.price}`,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`,
            `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          ]
        });

        return res.json({ action: 'qualified', program });
      }

      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      return res.json({ action: 'lead_updated' });
    }

    const market = detectMarket(phone);

    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    await sendWhatsApp(phone, 'welcome_v1', {
      name: senderName || 'there',
      templateParams: [senderName || 'there']
    });

    return res.json({ action: 'new_lead_created', leadId: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
