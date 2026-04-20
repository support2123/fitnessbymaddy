const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, normalizePhone, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalate } = require('../lib/escalation');
const { classifyInterest } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const body = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: body.slice(0, 2000),
      status: 'received'
    });

    if (isOptOut(body)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await escalate(phone, 'Medical/safety concern detected', body);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const isHinglish = market === 'IN';

      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: body.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = isHinglish
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new') {
      const match = classifyInterest(body);

      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('phone', phone);

        const market = existingLead.market || detectMarket(phone);
        const isHinglish = market === 'IN';

        const qualifyMsg = isHinglish
          ? `Great choice! 🔥 ${match.label} program ($${match.price}) perfect hai aapke liye.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill kar do: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Great choice! 🔥 The ${match.label} program ($${match.price}) is perfect for you.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nPlease also fill out your intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendWhatsApp({
          phone,
          body: qualifyMsg,
          templateName: 'program_offer',
          params: [name || 'there', match.label, String(match.price)]
        });

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
