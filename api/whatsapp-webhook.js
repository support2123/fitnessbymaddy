const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone, needsEscalation, classifyInterest, PROGRAM_LINKS } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
        templateParams: [maskPhone(phone), text.slice(0, 200)]
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', id: lead.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const interest = classifyInterest(text);
    if (interest && existingLead.status === 'new') {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: interest })
        .eq('id', existingLead.id);

      const link = PROGRAM_LINKS[interest];
      const market = existingLead.market || 'IN';
      const intakeLink = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? `Perfect! Ye raha tera program link: ${link}\n\nPehle ye short form bhar de taaki hum tera plan customize kar sakein: ${intakeLink}`
        : `Perfect! Here's your program link: ${link}\n\nPlease fill this short form so we can customize your plan: ${intakeLink}`;

      await sendWhatsApp(phone, 'program_link', {
        templateParams: [name || 'there', link, intakeLink]
      });

      return res.status(200).json({ action: 'qualified', program: interest });
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
