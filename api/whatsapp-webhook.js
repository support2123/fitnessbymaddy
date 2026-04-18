const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone, RATE_LIMIT_MS } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, needsOptOut, escalateToMaddy } = require('../lib/escalation');
const { matchProgram } = require('../lib/program-keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const messageText = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (needsOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out processed for ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone: maskPhone(phone),
        name: senderName,
        message: messageText,
      });
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
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString(),
      });

      const welcomeParams = isHinglish(market)
        ? ["Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      await db.from('messages').insert({
        phone,
        direction: 'out',
        body: welcomeParams[0],
        template_name: 'welcome_v1',
        sent_at: new Date().toISOString(),
        status: 'sent',
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      const matched = matchProgram(messageText);

      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program,
        }).eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkout}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const replyMsg = isHinglish(existingLead.market)
          ? `Great choice! 🎯 ${matched.name} ($${matched.price}) perfect hai aapke liye.\n\nCheckout: ${checkoutUrl}\n\nPehle yeh intake form bhar do: ${intakeUrl}`
          : `Great choice! 🎯 ${matched.name} ($${matched.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this intake form first: ${intakeUrl}`;

        const { data: lastOut } = await db
          .from('messages')
          .select('sent_at')
          .eq('phone', phone)
          .eq('direction', 'out')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        const canSend = !lastOut || (Date.now() - new Date(lastOut.sent_at).getTime()) > RATE_LIMIT_MS;

        if (canSend) {
          await sendTemplate(phone, 'program_match', [replyMsg]);

          await db.from('messages').insert({
            phone,
            direction: 'out',
            body: replyMsg,
            template_name: 'program_match',
            sent_at: new Date().toISOString(),
            status: 'sent',
          });
        }

        return res.status(200).json({ action: 'lead_qualified', program: matched.program });
      }

      return res.status(200).json({ action: 'lead_reply_no_match' });
    }

    return res.status(200).json({ action: 'existing_lead_updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
