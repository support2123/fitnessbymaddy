const { supabase } = require('../lib/supabase');
const { sendTemplate, sendFreeformMessage, notifyMaddy, logIncoming, detectMarket, normalizePhone } = require('../lib/whatsapp');
const { detectProgram, needsEscalation, getHinglishGreeting, programLabel } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const message = (payload.message || payload.text || payload.body || '').trim();

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logIncoming(phone, message);

    if (/^(stop|unsubscribe|optout|opt out)$/i.test(message.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Keyword trigger in message', `Phone: ${phone.slice(0,3)}XXX...${phone.slice(-3)}\nMessage: ${message.slice(0, 200)}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        status: 'new'
      });

      const greeting = getHinglishGreeting(market);
      await sendTemplate(phone, 'welcome_v1', [greeting]);
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    const program = detectProgram(message);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('phone', phone);

      const market = existingLead.market || 'IN';
      const label = programLabel(program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      let replyMsg;
      if (market === 'IN') {
        replyMsg = `Great choice! 💪 ${label} — yeh program bilkul aapke liye hai.\n\n` +
          `Checkout karo: ${checkoutUrl}\n\n` +
          `Aur yeh form bhi fill karo taaki Maddy aapka plan ready kar sake:\n${intakeUrl}`;
      } else {
        replyMsg = `Great choice! 💪 ${label} is perfect for your goals.\n\n` +
          `Complete your checkout: ${checkoutUrl}\n\n` +
          `Also fill out this form so Maddy can prepare your plan:\n${intakeUrl}`;
      }

      await sendFreeformMessage(phone, replyMsg);
      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
