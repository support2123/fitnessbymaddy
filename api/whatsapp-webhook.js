const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { routeToProgram, getProgramInfo } = require('../lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone in payload' });

    const db = getClient();

    await logMessage(phone, 'in', message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', phone, message);
      await db.from('escalations').insert({
        phone,
        reason: 'Sensitive keyword in message',
        context: message.substring(0, 500),
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, senderName, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped_lead' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      return await handleLeadQualification(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.substring(0, 1000),
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const welcomeMsg = isHinglish(market)
    ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');

  const program = routeToProgram(message);
  if (program) {
    await handleLeadQualification(db, lead, message, res);
    return;
  }

  return res.status(200).json({ action: 'new_lead_created', leadId: lead.id });
}

async function handleLeadQualification(db, lead, message, res) {
  const program = routeToProgram(message);
  if (!program) {
    return res.status(200).json({ action: 'no_program_match' });
  }

  const info = getProgramInfo(program);
  const market = lead.market || detectMarket(lead.phone);

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  let msg;
  if (isHinglish(market)) {
    msg = `Great choice! 🔥 ${info.name} — ₹${Math.round(info.price * 83)} mein.\n\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `Aur ye intake form bhi fill karo toh program tera body ke hisaab se customize hoga:\n${intakeUrl}`;
  } else {
    msg = `Great choice! 🔥 ${info.name} — $${info.price}.\n\n` +
      `Checkout here: ${checkoutUrl}\n\n` +
      `Also fill out this quick intake form so we can customise your program:\n${intakeUrl}`;
  }

  await sendText(lead.phone, msg);
  await logMessage(lead.phone, 'out', msg);

  return res.status(200).json({ action: 'qualified', program });
}
