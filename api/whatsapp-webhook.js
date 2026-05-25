const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendFreeformWhatsApp, logMessage } = require('./lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./lib/escalation');
const { detectMarket, maskPhone, classifyIntent, isOptOut, getLanguage } = require('./lib/helpers');

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

const INTAKE_FORM_URL = 'https://fitnessbymaddy.com/intake.html';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const payload = req.body || {};
    const phone = payload.phone || payload.from || payload.sender || '';
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await logMessage({ phone, direction: 'inbound', body: messageBody });

    if (isOptOut(messageBody)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);

      await sendFreeformWhatsApp(phone, "You've been unsubscribed. You won't receive further messages from FitnessByMaddy. Reply anytime if you change your mind!");
      return res.status(200).json({ status: 'opt_out_processed' });
    }

    const escalation = await checkEscalation(phone, messageBody);

    const { data: clientData } = await supabase
      .from('clients')
      .select('id, name, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (clientData) {
      return await handleClientMessage(res, { client: clientData, phone, messageBody, escalation });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(supabase, res, { phone, senderName, messageBody });
    }

    return await handleExistingLead(supabase, res, { lead: existingLead, phone, messageBody });
  } catch (err) {
    console.error(`whatsapp-webhook error [${maskPhone(req.body?.phone || '')}]:`, err.message || err);
    return res.status(200).json({ status: 'error_logged' });
  }
};

async function handleClientMessage(res, { client, phone, messageBody, escalation }) {
  if (escalation.escalated) {
    await sendFreeformWhatsApp(phone, "Thanks for reaching out! I've flagged your message and Maddy will get back to you shortly.");
  } else {
    await sendFreeformWhatsApp(
      phone,
      `Hi ${client.name || 'there'}! Thanks for your message. Maddy will respond soon. For your weekly check-in, use the link in your last program message.`
    );
  }
  return res.status(200).json({ status: 'client_reply_sent', client_id: client.id });
}

async function handleNewLead(supabase, res, { phone, senderName, messageBody }) {
  const market = detectMarket(phone);

  const { data: newLead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      phone,
      name: senderName || null,
      status: 'new',
      source: 'whatsapp',
      market,
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertErr) {
    console.error(`Failed to insert lead ${maskPhone(phone)}:`, insertErr.message);
  }

  const lang = getLanguage(market);
  if (lang === 'hinglish') {
    await sendWhatsApp(phone, 'welcome_v1', {
      templateParams: [senderName || 'there'],
    });
  } else {
    await sendWhatsApp(phone, 'welcome_v1_en', {
      templateParams: [senderName || 'there'],
    });
  }

  return res.status(200).json({ status: 'new_lead_created', lead_id: newLead?.id || null });
}

async function handleExistingLead(supabase, res, { lead, phone, messageBody }) {
  const intent = classifyIntent(messageBody);

  const updates = { last_msg_at: new Date().toISOString() };
  if (intent) updates.program_interest = intent;
  if (lead.status === 'new') updates.status = 'qualified';

  await supabase.from('leads').update(updates).eq('id', lead.id);

  if (intent && CHECKOUT_LINKS[intent]) {
    const checkoutUrl = CHECKOUT_LINKS[intent];
    const intakeUrl = `${INTAKE_FORM_URL}?lead=${lead.id}`;
    const market = detectMarket(phone);
    const lang = getLanguage(market);

    let message;
    if (lang === 'hinglish') {
      message = `Great choice! Yeh raha aapka checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhi fill kar do taaki Maddy aapka plan personalize kar sake:\n${intakeUrl}`;
    } else {
      message = `Great choice! Here's your checkout link:\n${checkoutUrl}\n\nPlease also fill out this quick intake form so Maddy can personalize your plan:\n${intakeUrl}`;
    }

    await sendFreeformWhatsApp(phone, message);
  } else {
    const market = detectMarket(phone);
    const lang = getLanguage(market);
    if (lang === 'hinglish') {
      await sendFreeformWhatsApp(phone, `Hi ${lead.name || 'there'}! Kya goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai? Batao toh best program suggest karte hain!`);
    } else {
      await sendFreeformWhatsApp(phone, `Hi ${lead.name || 'there'}! What's your main goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first? Let me know and I'll suggest the best program!`);
    }
  }

  return res.status(200).json({ status: 'existing_lead_handled', intent });
}
