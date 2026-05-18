const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, isHinglish, maskPhone } = require('./lib/whatsapp');
const { qualifyLead } = require('./lib/qualify');
const { escalateIfNeeded } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null
    });

    if (text.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalated = await escalateIfNeeded(phone, text);

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', escalated });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      });

      const welcomeParams = isHinglish(market)
        ? ['Maddy']
        : ['Maddy'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const match = qualifyLead(text);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const params = isHinglish(market)
        ? [match.name, `$${match.price}`, checkoutUrl, intakeUrl]
        : [match.name, `$${match.price}`, checkoutUrl, intakeUrl];

      await sendTemplate(phone, `qualify_${match.program}`, params);

      return res.status(200).json({ action: 'qualified', program: match.program });
    }

    return res.status(200).json({ action: 'message_logged', escalated });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
