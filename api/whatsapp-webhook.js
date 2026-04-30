const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getProgramDetails } = require('../lib/qualify');
const { jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    const phone = payload.phone || payload.senderPhone || payload.from;
    const messageText = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText.substring(0, 1000),
      status: 'received'
    });

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)}\nMessage: ${messageText.substring(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = hinglish
        ? ['Maddy ki team']
        : ["Maddy's team"];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', message: 'Lead previously opted out' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = qualifyLead(messageText);

      if (program) {
        const details = getProgramDetails(program);
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const rateOk = await canSendMessage(phone);
        if (rateOk && details) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.slug}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          let msg;
          if (hinglish) {
            msg = `Great choice! 💪 ${details.name} program tere liye perfect hai.\n\n` +
              `Price: $${details.price}\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Pehle ye form bhi fill kardo: ${intakeUrl}`;
          } else {
            msg = `Great choice! 💪 The ${details.name} program is perfect for your goals.\n\n` +
              `Price: $${details.price}\n\n` +
              `Checkout here: ${checkoutUrl}\n\n` +
              `Please also fill this quick form: ${intakeUrl}`;
          }

          await sendTemplate(phone, 'program_recommendation', [
            details.name,
            `$${details.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'existing_client', message: 'Forwarded to client support flow' });
    }

    return res.status(200).json({ action: 'processed' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
