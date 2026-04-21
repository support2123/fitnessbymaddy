const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, notifyMaddy } = require('../lib/escalation');
const { detectMarket, routeProgram, isHinglish, maskPhone, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = '+' + (body.senderDestination || body.mobile || body.from || '').replace('+', '');
    const text = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone || phone === '+') {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opted out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Keyword escalation', phone, `Message: "${text.slice(0, 200)}"`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      }).select().single();

      const welcomeParams = isHinglish(market)
        ? ['Hi! Maddy ki team yahan 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a $20 trial first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeProgram(text);
      if (route) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: route.program,
        }).eq('id', existingLead.id);

        const market = existingLead.market;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msgParams = isHinglish(market)
          ? [`${route.name} — bilkul sahi choice! 🔥\n\nPrice: $${route.price}\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`]
          : [`${route.name} — great choice! 🔥\n\nPrice: $${route.price}\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`];

        await sendWhatsApp(phone, 'program_match', msgParams);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (existingClient) {
        return res.status(200).json({ action: 'active_client_msg' });
      }

      return res.status(200).json({ action: 'unrouted_reply' });
    }

    return res.status(200).json({ action: 'existing_lead_msg' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
