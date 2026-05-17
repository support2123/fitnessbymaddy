const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendMessage, notifyMaddy, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, matchProgram, programLabel, programPrice } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const cleanPhone = phone.replace(/\D/g, '');

    await db.from('messages').insert({
      phone: maskPhone(cleanPhone),
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(cleanPhone)}\nMessage: ${text}`
      );
      return res.json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (!existingLead) {
      const market = detectMarket(cleanPhone);
      await db.from('leads').insert({
        phone: cleanPhone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(cleanPhone, 'welcome_v1', [senderName || 'there']);
      return res.json({ action: 'new_lead', greeting });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', cleanPhone);

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    const program = matchProgram(text);
    if (program && existingLead.status === 'new') {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', cleanPhone);

      const price = programPrice(program);
      const label = programLabel(program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const isIN = existingLead.market === 'IN';
      const msg = isIN
        ? `Great choice! 🔥 ${label} — $${price}\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad ye form fill karo: ${intakeUrl}`
        : `Great choice! 🔥 ${label} — $${price}\n\nCheckout: ${checkoutUrl}\n\nAfter payment, fill this form: ${intakeUrl}`;

      if (await canSendMessage(cleanPhone)) {
        await sendText(cleanPhone, msg);
      }

      return res.json({ action: 'qualified', program });
    }

    return res.json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
