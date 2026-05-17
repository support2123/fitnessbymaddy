const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', 'serious', 'premium', 'flagship', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    const lower = message.toLowerCase().trim();

    if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalate({ phone, reason: 'keyword_trigger', messageBody: message });
      return res.status(200).json({ action: 'escalated' });
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
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const greeting = market === 'IN'
    ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here 👋 What\'s your main goal — fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: greeting,
    params: [name || 'there']
  });

  return res.status(200).json({ action: 'new_lead_greeted' });
}

async function handleQualification(lead, message, res) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched = program;
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'no_match_logged' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const programNames = {
    '6wk_gym': '6-Week Burn & Build ($97)',
    'pcos': 'PCOS Warrior Program ($45)',
    '40plus': '40+ Strong Program ($50)',
    '12wk': '12-Week Custom Flagship ($200)',
    'zoom_trial': '$20 Zoom Trial Session'
  };

  const msg = lead.market === 'IN'
    ? `Perfect! ${programNames[matched]} aapke liye best hoga. Checkout: ${checkoutUrl}\n\nPehle ye form fill karo: ${intakeUrl}`
    : `Perfect! The ${programNames[matched]} is ideal for you. Checkout: ${checkoutUrl}\n\nPlease fill this intake form: ${intakeUrl}`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    body: msg,
    params: [programNames[matched], checkoutUrl, intakeUrl]
  });

  return res.status(200).json({ action: 'qualified', program: matched });
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.message) {
    return {
      phone: body.phone || body.from || body.sender,
      message: body.message || body.text || body.body,
      name: body.name || body.pushName || null
    };
  }
  // Meta Cloud API format (fallback)
  if (body.entry) {
    const change = body.entry[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from,
      message: msg?.text?.body || '',
      name: contact?.profile?.name || null
    };
  }
  return { phone: body.phone, message: body.message || body.text, name: body.name };
}
