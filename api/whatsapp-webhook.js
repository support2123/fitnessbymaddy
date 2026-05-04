const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { matchProgram } = require('./lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(messageBody)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message: messageBody.slice(0, 100) });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      });

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const programMatch = matchProgram(messageBody);

      if (programMatch) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: programMatch.programKey,
        }).eq('phone', phone);

        const market = existingLead.market || detectMarket(phone);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programMatch.checkoutSlug}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const msg = market === 'IN'
          ? [programMatch.name, `₹${programMatch.price * 83}`, checkoutUrl, intakeUrl]
          : [programMatch.name, `$${programMatch.price}`, checkoutUrl, intakeUrl];

        await sendWhatsApp(phone, 'program_offer', msg);
        return res.status(200).json({ action: 'program_offered', program: programMatch.programKey });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
