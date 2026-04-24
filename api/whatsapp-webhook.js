const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logInboundMessage, detectMarket, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

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
      return res.status(200).json({ ok: true, skipped: true });
    }

    const { phone, text, name } = message;
    const db = getSupabase();

    await logInboundMessage(phone, text);

    if (isOptOut(text)) {
      await handleOptOut(db, phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const lead = await findLead(db, phone);
      await escalateToMaddy(
        `Message contains flagged keyword`,
        lead?.name || name || 'Unknown',
        phone
      );
    }

    const existingLead = await findLead(db, phone);
    const existingClient = await findClient(db, phone);

    if (existingClient) {
      return res.status(200).json({ ok: true, action: 'existing_client' });
    }

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, text, res);
    }

    return res.status(200).json({ ok: true, action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal' });
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
      text: body.message,
      name: body.name || ''
    };
  }

  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function handleOptOut(db, phone) {
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
}

async function findLead(db, phone) {
  const { data } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

async function findClient(db, phone) {
  const { data } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();
  return data;
}

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
    created_at: new Date().toISOString()
  });

  await sendWhatsApp(phone, 'welcome_v1', { name: name || 'there', _isClient: false });

  return res.status(200).json({ ok: true, action: 'new_lead_greeted' });
}

async function handleLeadReply(db, lead, text, res) {
  await db.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const match = qualifyLead(text);
  if (!match) {
    return res.status(200).json({ ok: true, action: 'no_program_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${match.checkout_path}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const market = lead.market || detectMarket(lead.phone);
  const lang = market === 'IN';

  const msg = lang
    ? `Great choice! 🎯 ${match.name} program tere liye perfect hai.\n\n` +
      `💳 Checkout: ${checkoutUrl}\n` +
      `📋 Intake form bhar do: ${intakeUrl}\n\n` +
      `Koi sawaal ho toh pooch — Maddy ki team ready hai!`
    : `Great choice! 🎯 The ${match.name} program is perfect for you.\n\n` +
      `💳 Checkout: ${checkoutUrl}\n` +
      `📋 Fill out your intake form: ${intakeUrl}\n\n` +
      `Any questions? Maddy's team is here to help!`;

  await sendWhatsApp(lead.phone, 'welcome_v1', {
    name: lead.name || 'there',
    _isClient: false
  });

  await db.from('messages').insert({
    phone: lead.phone,
    direction: 'out',
    body: msg,
    template_name: 'qualification_response',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });

  return res.status(200).json({ ok: true, action: 'lead_qualified', program: match.program });
}
