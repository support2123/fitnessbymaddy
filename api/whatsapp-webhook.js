const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone, needsEscalation, notifyMaddy } = require('./lib/whatsapp');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name, timestamp } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (message.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(
        'Sensitive keyword detected',
        `Phone: ${maskPhone(phone)}\nMessage: ${message.slice(0, 100)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeMsg = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: { name: name || 'there', templateParams: [name || 'there'] }
      });

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const qualification = qualifyLead(message);

      if (qualification) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: qualification.programKey
          })
          .eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(qualification.programKey);
        const intakeUrl = getIntakeUrl(existingLead.id);
        const market = existingLead.market;

        const replyMsg = market === 'IN'
          ? `Perfect! 🔥 ${qualification.name} aapke liye best rahega.\n\n💰 Price: $${qualification.price}\n🔗 Checkout: ${checkoutUrl}\n\nPayment ke baad ye form fill karo:\n📋 ${intakeUrl}\n\nKoi doubt? Yahi poocho!`
          : `Perfect! 🔥 ${qualification.name} is ideal for your goal.\n\n💰 Price: $${qualification.price}\n🔗 Checkout: ${checkoutUrl}\n\nAfter payment, fill this intake form:\n📋 ${intakeUrl}\n\nAny questions? Ask here!`;

        await sendWhatsApp({
          phone,
          templateName: 'program_recommendation',
          body: replyMsg,
          params: { templateParams: [qualification.name, String(qualification.price), checkoutUrl] }
        });

        return res.status(200).json({ action: 'qualified', program: qualification.programKey });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseWebhookPayload(body) {
  if (body.response) {
    return {
      phone: body.response.from || body.response.sender,
      message: body.response.text || body.response.body || '',
      name: body.response.name || null,
      timestamp: body.response.timestamp
    };
  }

  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name || null,
      timestamp: msg.timestamp
    };
  }

  return {
    phone: body.phone || body.from,
    message: body.message || body.text || body.body || '',
    name: body.name || null,
    timestamp: body.timestamp
  };
}
