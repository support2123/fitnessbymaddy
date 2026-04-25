const db = require('./_lib/supabase');
const wa = require('./_lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  detectProgram, programDisplayName, maskPhone, cors,
} = require('./_lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender?.phone;
    const text = payload.text || payload.message?.text || payload.body || '';
    const name = payload.name || payload.sender?.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.insert('messages', {
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, name, text);
    }

    const existing = await db.query('leads', `phone=eq.${phone}&select=*`);

    if (existing.length === 0) {
      return await handleNewLead(phone, name, text, market, hinglish, res);
    }

    const lead = existing[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    return await handleReply(lead, text, hinglish, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, text, market, hinglish, res) {
  await db.insert('leads', {
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const welcomeMsg = hinglish
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?";

  try {
    await wa.sendTemplate(phone, 'welcome_v1', [welcomeMsg], name || 'there');
  } catch {
    console.error(`Welcome template failed for ${maskPhone(phone)}, trying text`);
  }

  await db.insert('messages', {
    phone,
    direction: 'out',
    body: welcomeMsg,
    template_name: 'welcome_v1',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleReply(lead, text, hinglish, res) {
  await db.update('leads', { id: lead.id }, {
    last_msg_at: new Date().toISOString(),
  });

  const program = detectProgram(text);
  if (!program) {
    return res.status(200).json({ action: 'no_program_match', lead_id: lead.id });
  }

  await db.update('leads', { id: lead.id }, {
    status: 'qualified',
    program_interest: program,
  });

  const displayName = programDisplayName(program);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const replyMsg = hinglish
    ? `Great choice! 🔥 "${displayName}" perfect hai tere liye.\n\nPayment link: ${checkoutUrl}\n\nSaath mein ye form bhi fill kardo so Maddy can build your plan: ${intakeUrl}`
    : `Great choice! 🔥 "${displayName}" is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nAlso fill this form so Maddy can build your plan: ${intakeUrl}`;

  try {
    await wa.sendTemplate(lead.phone, 'program_checkout', [displayName, checkoutUrl, intakeUrl], lead.name || 'there');
  } catch {
    console.error(`Checkout template failed for ${maskPhone(lead.phone)}`);
  }

  await db.insert('messages', {
    phone: lead.phone,
    direction: 'out',
    body: replyMsg,
    template_name: 'program_checkout',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });

  return res.status(200).json({ action: 'qualified', program, lead_id: lead.id });
}

async function handleOptOut(phone) {
  await db.update('leads', { phone }, { status: 'dropped' });
  await db.insert('messages', {
    phone,
    direction: 'out',
    body: 'You have been unsubscribed. We will not message you again.',
    template_name: 'opt_out',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}

async function escalateToMaddy(phone, name, text) {
  const alertMsg = `⚠️ ESCALATION\nFrom: ${maskPhone(phone)} (${name || 'Unknown'})\nMessage: "${text.slice(0, 200)}"`;
  try {
    await wa.sendTemplate(MADDY_PHONE, 'escalation_alert', [alertMsg], 'Maddy');
  } catch (err) {
    console.error('Escalation alert failed:', err.message);
  }
}
