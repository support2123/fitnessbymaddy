const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { matchProgram } = require('../lib/program-keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.sender);
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).maybeSingle();
      await createEscalation(phone, 'keyword_trigger', message, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'updated' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market
  }).select().single();

  const isHinglish = market === 'IN';
  if (isHinglish) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  }

  const matched = matchProgram(message);
  if (matched) {
    await handleQualification(db, lead, message, res);
    return;
  }

  return res.json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const matched = matchProgram(message);
  if (!matched) {
    return res.json({ action: 'awaiting_qualification' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const market = detectMarket(lead.phone);
  const isHinglish = market === 'IN';

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${matched.checkoutPath}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (isHinglish) {
    await sendTextMessage(lead.phone, [
      `Perfect! 🎯 ${matched.name} program tumhare liye best rahega.`,
      ``,
      `💰 Price: ${matched.price}`,
      `🔗 Checkout: ${checkoutUrl}`,
      ``,
      `Payment ke baad ye form bhi fill karo:`,
      `📋 ${intakeUrl}`,
      ``,
      `Koi doubt ho toh pooch lo! 💪`
    ].join('\n'));
  } else {
    await sendTextMessage(lead.phone, [
      `Perfect! 🎯 The ${matched.name} program is a great fit for you.`,
      ``,
      `💰 Price: ${matched.price}`,
      `🔗 Checkout: ${checkoutUrl}`,
      ``,
      `After payment, please fill out this form:`,
      `📋 ${intakeUrl}`,
      ``,
      `Any questions? Just ask! 💪`
    ].join('\n'));
  }

  return res.json({ action: 'qualified', program: matched.program });
}

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}
