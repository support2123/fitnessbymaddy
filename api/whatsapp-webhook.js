const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const messageBody = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lower = messageBody.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      await escalate('Keyword trigger in message', phone, messageBody.slice(0, 200));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select().single();

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = qualifyLead(messageBody);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'IN';
        const isHinglish = market === 'IN';

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = isHinglish
          ? `Perfect! 🔥 Tumhare liye best hoga: *${route.label}* ($${route.price})\n\n` +
            `Checkout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
          : `Perfect! 🔥 Best fit for you: *${route.label}* ($${route.price})\n\n` +
            `Checkout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

        await sendTemplate(phone, 'program_match', [
          route.label,
          String(route.price),
          checkoutUrl,
          intakeUrl
        ]);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      return res.status(200).json({ action: 'reply_noted' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (client) {
      return res.status(200).json({ action: 'active_client_reply' });
    }

    return res.status(200).json({ action: 'reply_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
