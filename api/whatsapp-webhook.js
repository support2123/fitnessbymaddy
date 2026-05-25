const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, getWelcomeMessage } = require('./_lib/market');
const { needsEscalation, getEscalationReason, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead, isOptOut } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;

    const phone = payload.mobile || payload.from || payload.senderMobile;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      status: 'received'
    });

    if (isOptOut(messageBody)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      const reason = getEscalationReason(messageBody);
      const { data: lead } = await supabase.from('leads').select('id').eq('phone', phone).single();
      const { data: client } = await supabase.from('clients').select('id').eq('phone', phone).single();
      await escalateToMaddy(phone, reason, messageBody, client?.id, lead?.id);
      return res.status(200).json({ action: 'escalated', reason });
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
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcome = getWelcomeMessage(market);
      await sendWhatsApp(phone, welcome, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const match = qualifyLead(messageBody);
      if (match) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('phone', phone);

        const market = existingLead.market || 'GLOBAL';
        let msg;
        if (market === 'IN') {
          msg = `Great choice! 🔥 ${match.name} ($${match.price}) tumhare liye perfect hai.\n\n` +
            `👉 Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n` +
            `📝 Intake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}\n\n` +
            `Payment ke baad turant access milega!`;
        } else {
          msg = `Great choice! 🔥 ${match.name} ($${match.price}) is perfect for you.\n\n` +
            `👉 Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n` +
            `📝 Fill intake form: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}\n\n` +
            `You'll get instant access after payment!`;
        }

        await sendWhatsApp(phone, msg, null);
        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
