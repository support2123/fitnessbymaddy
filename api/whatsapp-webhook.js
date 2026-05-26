const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { KEYWORD_TO_PROGRAM, PROGRAMS } = require('../lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    const lower = message.toLowerCase().trim();

    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
      await createEscalation(phone, 'keyword_trigger', message, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    return res.json({ action: 'logged', lead_status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.mobile || body.from || body.waId,
    message: body.message || body.text || body.body || body.msg,
    name: body.name || body.pushName || body.senderName,
  };
}

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market,
  });

  const welcomeMsg = hinglish
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your main goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

  return res.json({ action: 'new_lead_welcomed', market });
}

async function handleQualification(db, lead, message, res) {
  const lower = message.toLowerCase();
  const hinglish = isHinglish(lead.market);

  let matched = null;
  for (const entry of KEYWORD_TO_PROGRAM) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      matched = entry.program;
      break;
    }
  }

  if (!matched) {
    const clarifyMsg = hinglish
      ? 'Thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya 12-week custom plan? Trial bhi available hai!'
      : "Could you tell me more? Are you looking for fat loss, PCOS support, 40+ fitness, or a full 12-week custom plan? We also have a trial option!";
    await sendWhatsApp(lead.phone, clarifyMsg, null);
    return res.json({ action: 'asked_clarification' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched,
  }).eq('id', lead.id);

  const prog = PROGRAMS[matched];
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const qualMsg = hinglish
    ? `Great choice! ${prog.name} — $${prog.price}.\n\nCheckout karo: ${checkoutUrl}\n\nAur yeh intake form bhi fill karo: ${intakeUrl}`
    : `Great choice! ${prog.name} — $${prog.price}.\n\nComplete your purchase: ${checkoutUrl}\n\nAlso fill out your intake form: ${intakeUrl}`;

  await sendWhatsApp(lead.phone, qualMsg, null);

  return res.json({ action: 'qualified', program: matched });
}
