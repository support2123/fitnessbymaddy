const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { checkEscalation } = require('./lib/escalation');
const { matchProgram } = require('./lib/program-router');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'WhatsApp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    checkEscalation(message, phone);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const program = matchProgram(message);
      if (program) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: program.program
          })
          .eq('id', existingLead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${program.checkoutSlug}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_recommendation', {
          name: existingLead.name || 'there',
          templateParams: [
            existingLead.name || 'there',
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl
          ]
        });

        return res.status(200).json({
          action: 'qualified',
          program: program.program,
          lead_id: existingLead.id
        });
      }

      return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const market = detectMarket(phone);
    const { data: newLead, error: insertError } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select()
      .single();

    if (insertError) {
      console.error('Lead insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to create lead' });
    }

    await sendWhatsApp(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({
      action: 'new_lead',
      lead_id: newLead.id,
      market
    });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
