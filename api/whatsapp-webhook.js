const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { matchProgram } = require('../lib/keywords');
const { maskPhone } = require('../lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const type = classifyEscalation(text);
      await notifyMaddy(
        `${type} escalation`,
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
      return res.status(200).json({ action: 'escalated', type });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    market
  }).select().single();

  const welcomeParams = {
    name: name || 'there',
    templateParams: hinglish
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?']
  };

  await sendTemplate(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const matched = matchProgram(text);
  const hinglish = isHinglish(lead.market);

  if (!matched) {
    const msg = hinglish
      ? 'Koi tension nahi! Yeh options hain:\n\n1. Fat Loss (6 Week Shred)\n2. PCOS Program\n3. 40+ Fitness\n4. 12 Week Custom (Maddy ka best)\n5. Zoom Trial ($20)\n\nKaunsa try karna hai?'
      : 'No worries! Here are your options:\n\n1. Fat Loss (6 Week Shred)\n2. PCOS Program\n3. 40+ Fitness\n4. 12 Week Custom (Maddy\'s best)\n5. Zoom Trial ($20)\n\nWhich one interests you?';

    await sendText(lead.phone, msg);
    return res.status(200).json({ action: 'options_sent' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkoutSlug}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const msg = hinglish
    ? `Great choice! 🎯 ${matched.name} program — $${matched.price}\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad, yeh form fill karo:\n${intakeUrl}\n\nKoi question ho toh pooch lo!`
    : `Great choice! 🎯 ${matched.name} — $${matched.price}\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, please fill this form:\n${intakeUrl}\n\nAny questions? Just ask!`;

  await sendText(lead.phone, msg);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}
