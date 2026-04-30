const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, detectMarket } = require('./_lib/whatsapp');
const { qualifyLead, isOptOut } = require('./_lib/qualify');
const { needsEscalation, notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.waId || '';
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || '';
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    if (!cleanPhone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    await supabase.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      console.log(`Opt-out: ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Escalation keyword detected in lead message', {
        phone: maskPhone(cleanPhone),
        message: message.slice(0, 200)
      }, sendWhatsApp);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'ignored_dropped' });
      }

      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString(),
        name: name || existingLead.name
      }).eq('id', existingLead.id);

      if (existingLead.status === 'new') {
        const match = qualifyLead(message);
        if (match) {
          const market = detectMarket(cleanPhone);
          const isHinglish = market === 'IN';

          await supabase.from('leads').update({
            status: 'qualified',
            program_interest: match.program,
            market
          }).eq('id', existingLead.id);

          const qualifyMsg = isHinglish
            ? `Perfect! "${match.label}" program tere liye best rahega. Price: $${match.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhar do taaki Maddy tera plan bana sake:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
            : `Perfect! The "${match.label}" program is the best fit for you. Price: $${match.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nFill out your intake form so Maddy can build your plan:\nhttps://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          await sendWhatsApp(cleanPhone, qualifyMsg);
          return res.status(200).json({ action: 'qualified', program: match.program });
        }
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(cleanPhone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone: cleanPhone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const isHinglish = market === 'IN';
    const welcomeMsg = isHinglish
      ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp(cleanPhone, welcomeMsg, 'welcome_v1');

    const match = qualifyLead(message);
    if (match) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', newLead.id);

      const qualifyMsg = isHinglish
        ? `"${match.label}" tere liye perfect hai! Price: $${match.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}\n\nIntake form: https://www.fitnessbymaddy.com/intake?lead=${newLead.id}`
        : `The "${match.label}" program is perfect for you! Price: $${match.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}\n\nIntake form: https://www.fitnessbymaddy.com/intake?lead=${newLead.id}`;

      await sendWhatsApp(cleanPhone, qualifyMsg);
    }

    return res.status(200).json({ action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
