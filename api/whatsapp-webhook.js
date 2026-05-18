const { getSupabase } = require('./lib/supabase');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');
const { sendTemplate, sendTextMessage } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/pii');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  let phone, messageText, senderName;

  try {
    const body = req.body;
    phone = body.mobile || body.phone || body.from || body.waId;
    messageText = body.text || body.message || body.body || '';
    senderName = body.name || body.pushName || body.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    if (!phone.startsWith('+')) phone = '+' + phone;

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText,
      status: 'received'
    });

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await notifyMaddy(
        'Escalation keyword detected',
        `Phone: ${maskPhone(phone)}, Message: ${messageText.slice(0, 100)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market
      });

      await sendTemplate(phone, 'welcome_v1', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    const qualification = qualifyLead(messageText);
    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program
      }).eq('phone', phone);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (hinglish) {
        await sendTextMessage(phone,
          `${qualification.programName} — perfect choice! 🔥\n\n` +
          `Yeh raha checkout link:\n${checkoutUrl}\n\n` +
          `Aur yeh intake form bhi fill karo toh Maddy apka plan aur better bana sakti hai:\n${intakeUrl}`
        );
      } else {
        await sendTextMessage(phone,
          `${qualification.programName} — great choice! 🔥\n\n` +
          `Here's your checkout link:\n${checkoutUrl}\n\n` +
          `Also fill out this quick intake form so Maddy can customise your plan:\n${intakeUrl}`
        );
      }

      return res.status(200).json({ action: 'lead_qualified', program: qualification.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error(`Webhook error for ${phone ? maskPhone(phone) : 'unknown'}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
