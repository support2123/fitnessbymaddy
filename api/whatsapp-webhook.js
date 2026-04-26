const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, checkRateLimit, detectMarket, needsEscalation, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { qualifyLead, isOptOut } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Lead needs human review', `Phone: ${maskPhone(phone)}\nMessage: ${text}`);
      await sendText(phone, "Thanks for sharing that. Maddy will personally review this and get back to you shortly. 🙏");
      return res.json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const canSend = await checkRateLimit(phone);
      if (canSend) {
        if (market === 'IN') {
          await sendTemplate(phone, 'welcome_v1', [name || 'there']);
        } else {
          await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
        }
      }

      return res.json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const qualification = qualifyLead(text);

      if (qualification) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program
        }).eq('id', existingLead.id);

        const canSend = await checkRateLimit(phone);
        if (canSend) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          const market = existingLead.market;
          if (market === 'IN') {
            await sendText(phone,
              `Great choice! 💪 ${qualification.label} is perfect for you.\n\n` +
              `💰 Price: $${qualification.price}\n` +
              `🔗 Checkout: ${checkoutUrl}\n\n` +
              `Payment ke baad, yeh form bhi fill karo taaki Maddy tumhara plan bana sake:\n` +
              `📋 ${intakeUrl}\n\n` +
              `Questions? Just reply here!`
            );
          } else {
            await sendText(phone,
              `Great choice! 💪 ${qualification.label} is perfect for you.\n\n` +
              `💰 Price: $${qualification.price}\n` +
              `🔗 Checkout: ${checkoutUrl}\n\n` +
              `After payment, fill out this intake form so Maddy can build your plan:\n` +
              `📋 ${intakeUrl}\n\n` +
              `Questions? Just reply here!`
            );
          }
        }

        return res.json({ action: 'qualified', program: qualification.program });
      }

      const canSend = await checkRateLimit(phone);
      if (canSend) {
        await sendText(phone,
          "Thanks for your message! Could you tell me more about your goal? " +
          "Fat loss, PCOS management, 40+ fitness, or a custom 12-week program? " +
          "Or if you'd like to test the waters, we have a $20 Zoom trial! 🎯"
        );
      }

      return res.json({ action: 'awaiting_qualification' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await sendText(phone, "Got your message! Maddy or the team will reply soon. 🙏");
      return res.json({ action: 'client_message_logged' });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
