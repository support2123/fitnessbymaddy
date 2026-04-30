const supabase = require('../lib/supabase');
const { sendTemplate, sendTextMessage, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { checkEscalation, checkOptOut } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name, senderName } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const contactName = name || senderName || null;

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (checkOptOut(message)) {
      await supabase
        .from('leads')
        .update({ opted_out: true, status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.escalate) {
      await notifyMaddy(
        'Escalation Required',
        `Phone: ${maskPhone(phone)}\nKeywords: ${escalation.keywords.join(', ')}\nMessage: ${message.slice(0, 200)}`
      );
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
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'active_client_message', escalation: escalation.escalate });
    }

    if (!existingLead) {
      return await handleNewLead(phone, message, contactName, escalation, res);
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    if (existingLead.status === 'dropped') {
      await supabase
        .from('leads')
        .update({ status: 'new', last_msg_at: new Date().toISOString(), opted_out: false })
        .eq('id', existingLead.id);
    }

    return await handleExistingLead(existingLead, phone, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body?.message) {
    return {
      phone: body.phone ? (body.phone.startsWith('+') ? body.phone : `+${body.phone}`) : null,
      message: body.message,
      name: body.name || body.senderName || null,
      senderName: body.senderName || null
    };
  }

  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from ? `+${msg.from}` : null,
      message: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null,
      senderName: null
    };
  }

  return { phone: null, message: null, name: null, senderName: null };
}

async function handleNewLead(phone, message, name, escalation, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const hinglish = isHinglish(market);

  if (escalation.escalate) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: hinglish
        ? ['Hi! Maddy\'s team here. Aapka message mila — Maddy personally review karengi. Kuch bhi medical ya special concern ho toh please share karein.']
        : ['Hi! Maddy\'s team here. We\'ve received your message — Maddy will personally review it. If you have any medical or special concerns, please share them.']
    });
  } else {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: hinglish
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?']
    });
  }

  const qualification = qualifyLead(message);
  if (qualification) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: qualification.program })
      .eq('id', lead.id);

    await sendQualificationResponse(phone, qualification, hinglish, lead.id);
  }

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id, qualified: !!qualification });
}

async function handleExistingLead(lead, phone, message, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'qualified' || lead.status === 'new') {
    const qualification = qualifyLead(message);
    if (qualification) {
      const hinglish = isHinglish(lead.market);
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: qualification.program })
        .eq('id', lead.id);
      await sendQualificationResponse(phone, qualification, hinglish, lead.id);
      return res.status(200).json({ action: 'qualified', program: qualification.program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
}

async function sendQualificationResponse(phone, qualification, hinglish, leadId) {
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualification.checkoutSlug}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${leadId}`;

  const msg = hinglish
    ? `${qualification.name} — bilkul sahi choice! 💪\n\nPrice: $${qualification.price}\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo taaki Maddy aapke liye personalized plan bana sakein:\n${intakeUrl}`
    : `${qualification.name} — great choice! 💪\n\nPrice: $${qualification.price}\n\nCheckout: ${checkoutUrl}\n\nAlso fill out this intake form so Maddy can build your personalized plan:\n${intakeUrl}`;

  await sendTextMessage(phone, msg);
}
