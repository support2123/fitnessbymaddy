const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { matchProgram, PROGRAM_MAP } = require('../lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (message.toLowerCase().match(/^(stop|unsubscribe|opt.?out)$/)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
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

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_greeted', lead_id: newLead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped_lead' });
    }

    const programKey = matchProgram(message);
    if (programKey && existingLead.status === 'new') {
      const program = PROGRAM_MAP[programKey];

      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: programKey })
        .eq('id', existingLead.id);

      const market = existingLead.market || detectMarket(phone);
      const checkoutMsg = market === 'IN'
        ? `Great choice! 🔥 ${program.name} — ₹${program.price * 83}/- mein full access. Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
        : `Great choice! 🔥 ${program.name} — $${program.price} for full access. Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}\n\nPlease fill the intake form too: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, 'program_checkout', {
        name: existingLead.name || 'there',
        templateParams: [existingLead.name || 'there', program.name, `$${program.price}`]
      });

      return res.status(200).json({ action: 'qualified', program: programKey });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
