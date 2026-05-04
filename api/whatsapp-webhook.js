const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, classifyIntent, needsEscalation, isOptOut, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.waId;
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
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
      await escalateToMaddy('health_concern', { clientName: name, phone: maskPhone(phone), message });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, program, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      const intent = classifyIntent(message);
      if (intent) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: intent })
          .eq('id', existingLead.id);

        const market = detectMarket(phone);
        const checkoutMsg = buildCheckoutMessage(intent, market, existingLead.id);
        await sendWhatsApp(phone, 'program_checkout', {
          name,
          templateParams: [name || 'there', checkoutMsg.programName, checkoutMsg.price, checkoutMsg.link]
        });
      }

      return res.status(200).json({ action: 'existing_lead_updated', intent });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, welcomeTemplate, {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    const intent = classifyIntent(message);
    if (intent) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', newLead.id);

      const checkoutMsg = buildCheckoutMessage(intent, market, newLead.id);
      await sendWhatsApp(phone, 'program_checkout', {
        name,
        templateParams: [name || 'there', checkoutMsg.programName, checkoutMsg.price, checkoutMsg.link]
      });
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function buildCheckoutMessage(intent, market, leadId) {
  const programs = {
    '6wk_gym': { programName: '6-Week Burn & Build', price: '$45', slug: '6-week-burn' },
    '6wk_home': { programName: '6-Week Home Shred', price: '$40', slug: '6-week-home' },
    '12wk': { programName: '12-Week Custom Flagship', price: '$200', slug: '12-week-custom' },
    'pcos': { programName: 'PCOS Warrior Program', price: '$45', slug: 'pcos-warrior' },
    '40plus': { programName: '40+ Strong Program', price: '$50', slug: '40-plus-strong' },
    'zoom_trial': { programName: 'Zoom Trial Session', price: '$20', slug: 'zoom-trial' },
    'zoom_pack': { programName: 'Zoom 4-Pack', price: '$70', slug: 'zoom-pack' }
  };

  const prog = programs[intent] || programs['zoom_trial'];
  return {
    programName: prog.programName,
    price: prog.price,
    link: `https://fitnessbymaddyy.exlyapp.com/checkout/${prog.slug}?ref=${leadId}`
  };
}
