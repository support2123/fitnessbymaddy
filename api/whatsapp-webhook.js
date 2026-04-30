const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'patla'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'best'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session' },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program' },
];

const OPT_OUT = ['stop', 'unsubscribe', 'cancel', 'opt out', 'band karo'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    const lowerMsg = message.toLowerCase().trim();

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (OPT_OUT.some(kw => lowerMsg.includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalate(phone, 'Sensitive keywords detected', message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.phone && body.message) {
    return { phone: body.phone, message: body.message, name: body.name || null };
  }
  if (body.data) {
    return {
      phone: body.data.phone || body.data.from,
      message: body.data.message || body.data.text || body.data.body,
      name: body.data.name || body.data.pushName || null
    };
  }
  return { phone: null, message: null, name: null };
}

async function handleNewLead(phone, name, firstMsg, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: firstMsg,
    last_msg_at: new Date().toISOString(),
    market
  });

  const hinglish = isHinglish(market);
  const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';

  await sendWhatsApp({
    phone,
    templateName,
    body: hinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?",
    params: []
  });

  return res.status(200).json({ action: 'new_lead_welcomed', market });
}

async function handleQualification(lead, message, res) {
  const lowerMsg = message.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lowerMsg.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'no_keyword_match', message_logged: true });
  }

  await supabase.from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const body = hinglish
    ? `Great choice! 🔥 ${matched.label} aapke liye perfect hai.\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nKoi question ho toh pooch lo!`
    : `Great choice! 🔥 ${matched.label} is perfect for you.\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nAny questions? Just ask!`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_checkout',
    body,
    params: [matched.label, checkoutUrl, intakeUrl]
  });

  return res.status(200).json({ action: 'qualified', program: matched.program });
}
