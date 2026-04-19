const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket, needsEscalation, notifyMaddy } = require('./lib/whatsapp');
const { jsonResponse, errorResponse, routeProgram } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    let phone, text, senderName;
    if (body.entry) {
      const change = body.entry?.[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      if (!msg) return res.status(200).json({ ok: true });
      phone = msg.from;
      text = msg.text?.body || '';
      senderName = change?.contacts?.[0]?.profile?.name || null;
    } else {
      phone = body.mobile || body.phone || body.from;
      text = body.message || body.text || body.body || '';
      senderName = body.name || null;
    }

    if (!phone) return res.status(200).json({ ok: true });

    if (!phone.startsWith('+')) phone = '+' + phone;

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lower = text.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs attention',
        `${maskPhone(phone)} said: "${text.slice(0, 100)}"`
      );
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
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, 'welcome_v1', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      }, greeting);

      return res.status(200).json({ ok: true, action: 'new_lead_greeted' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_no_reply' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const match = routeProgram(text);
      if (match) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: match.program })
          .eq('phone', phone);

        const market = existingLead.market || 'IN';
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const msg = market === 'IN'
          ? `Great choice! ${match.name} program ($${match.price}) perfect hai aapke liye. 💪\n\nCheckout: ${checkoutUrl}\n\nSaath mein ye form bhi fill kar do: ${intakeUrl}`
          : `Great choice! The ${match.name} program ($${match.price}) is perfect for you. 💪\n\nCheckout: ${checkoutUrl}\n\nAlso fill out your intake form: ${intakeUrl}`;

        await sendWhatsApp(phone, 'program_recommendation', {
          name: existingLead.name || 'there',
          templateParams: [existingLead.name || 'there', match.name, String(match.price)]
        }, msg);

        return res.status(200).json({ ok: true, action: 'program_recommended', program: match.program });
      }
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
