const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');
const { maskPhone } = require('../lib/masking');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const message = extractMessage(body);
    if (!message) {
      return res.status(200).json({ status: 'no_message' });
    }

    const { phone, text, name } = message;
    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: (text || '').slice(0, 1000),
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'lead_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || '',
      name: contact?.profile?.name || ''
    };
  }

  if (body?.phone && body?.message) {
    return {
      phone: body.phone.startsWith('+') ? body.phone : '+' + body.phone,
      text: body.message || '',
      name: body.name || ''
    };
  }

  return null;
}

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: (text || '').slice(0, 500),
    last_msg_at: new Date().toISOString(),
    market,
    created_at: new Date().toISOString()
  });

  const welcomeMsg = isHinglish(market)
    ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

  console.log(`New lead: ${maskPhone(phone)} market=${market}`);
  return res.status(200).json({ status: 'new_lead_created' });
}

async function handleQualification(db, lead, text, res) {
  const match = qualifyLead(text);

  if (!match) {
    const followUp = isHinglish(lead.market)
      ? 'Koi baat nahi! Mujhe apna goal batao — fat loss, muscle building, PCOS, ya kuch aur? Main sahi program suggest karungi 💪'
      : 'No worries! Tell me your main goal — fat loss, muscle building, PCOS, or something else? I\'ll recommend the perfect program 💪';

    await sendWhatsApp(lead.phone, followUp, null);
    return res.status(200).json({ status: 'awaiting_goal' });
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutMsg = isHinglish(lead.market)
    ? `Great choice! 🎯 Tumhare liye ${match.label} perfect rahega.\n\nPrice: $${match.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n\nPurchase ke baad, yeh intake form bhi fill karna:\nhttps://fitnessbymaddy.com/intake.html?lead=${lead.id}`
    : `Great choice! 🎯 The ${match.label} program is perfect for you.\n\nPrice: $${match.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n\nAfter purchase, please fill out this intake form:\nhttps://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  await sendWhatsApp(lead.phone, checkoutMsg, null);

  console.log(`Lead qualified: ${maskPhone(lead.phone)} → ${match.program}`);
  return res.status(200).json({ status: 'qualified', program: match.program });
}
