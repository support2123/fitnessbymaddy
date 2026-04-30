const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { matchProgram } = require('./lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'whatsapp webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from);
    const messageText = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage({
      phone,
      direction: 'in',
      body: messageText,
      template_name: null,
      status: 'received'
    });

    if (isOptOut(messageText)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(messageText);
    if (esc.escalate) {
      await escalateToMaddy({
        reason: `Keyword detected: "${esc.trigger}"`,
        phone,
        clientName: senderName,
        messageText
      });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await handleExistingLead(db, existingLead, messageText, phone);
    } else {
      await handleNewLead(db, phone, senderName, messageText);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, messageText) {
  const market = detectMarket(phone);
  const matched = matchProgram(messageText);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: messageText,
    last_msg_at: new Date().toISOString(),
    program_interest: matched?.program || null,
    market,
    created_at: new Date().toISOString()
  }).select().single();

  if (matched) {
    await sendProgramReply(phone, matched, lead, market);
    await db.from('leads').update({
      status: 'qualified',
      program_interest: matched.program
    }).eq('id', lead.id);
  } else {
    const hinglish = isHinglishMarket(market);
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      body: hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?",
      params: { name: name || 'there', templateParams: [name || 'there'] }
    });
  }
}

async function handleExistingLead(db, lead, messageText, phone) {
  if (lead.status === 'dropped') return;

  await db.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const matched = matchProgram(messageText);
    if (matched) {
      await sendProgramReply(phone, matched, lead, lead.market);
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program
      }).eq('id', lead.id);
    }
  }
}

async function sendProgramReply(phone, program, lead, market) {
  const hinglish = isHinglishMarket(market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const body = hinglish
    ? `Great choice! 🔥 ${program.name} — $${program.price}\n\nYe raha checkout link:\n${checkoutUrl}\n\nAur ye intake form bhar do taaki hum tumhare liye best plan bana sakein:\n${intakeUrl}`
    : `Great choice! 🔥 ${program.name} — $${program.price}\n\nHere's your checkout link:\n${checkoutUrl}\n\nPlease also fill out this intake form so we can build the best plan for you:\n${intakeUrl}`;

  await sendWhatsApp({
    phone,
    templateName: 'program_offer',
    body,
    params: {
      name: lead.name || 'there',
      templateParams: [lead.name || 'there', program.name, `$${program.price}`]
    }
  });
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.toString().replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
}
