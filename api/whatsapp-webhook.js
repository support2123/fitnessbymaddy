const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { shouldEscalate, createEscalation } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    const lower = message.toLowerCase().trim();

    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = shouldEscalate(message);
    if (escalationKeyword) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      await createEscalation(
        phone,
        `Keyword detected: "${escalationKeyword}"`,
        message,
        client?.id
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_opted_out' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market
        })
        .select()
        .single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const match = qualifyLead(message);
      if (match) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program
          })
          .eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(match.program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendText(phone,
            `Great choice! 🔥 ${match.label} program perfect hai tere liye.\n\n` +
            `👉 Checkout: ${checkoutUrl}\n\n` +
            `Pehle ye form bhi bhar de taaki hum tera plan ready kar sakein:\n` +
            `📋 ${intakeUrl}`
          );
        } else {
          await sendText(phone,
            `Great choice! 🔥 The ${match.label} program is perfect for you.\n\n` +
            `👉 Checkout: ${checkoutUrl}\n\n` +
            `Please also fill this form so we can prepare your plan:\n` +
            `📋 ${intakeUrl}`
          );
        }

        return res.status(200).json({ action: 'qualified', program: match.program });
      }

      if (await canSendToLead(phone)) {
        if (isHinglish(market)) {
          await sendText(phone,
            `Hey! Bata na — fat loss, PCOS, strength ya 40+ fitness? ` +
            `Ya pehle trial try karna hai? 💪`
          );
        } else {
          await sendText(phone,
            `Hey! Let us know — are you looking for fat loss, PCOS management, strength, ` +
            `or 40+ fitness? Or would you like to try a trial first? 💪`
          );
        }
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
