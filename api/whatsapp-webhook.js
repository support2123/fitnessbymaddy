const { supabase } = require('./lib/supabase');
const { sendWhatsApp, canSendMessage, detectMarket, maskPhone } = require('./lib/whatsapp');
const { shouldEscalate, createEscalation } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'fat': '6wk_gym', 'lose': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

function classifyIntent(msg) {
  const lower = (msg || '').toLowerCase();

  if (lower === 'stop' || lower === 'unsubscribe') return { action: 'optout' };

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return { action: 'qualify', program };
  }

  return { action: 'unknown' };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name, timestamp } = extractPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (shouldEscalate(message)) {
      await createEscalation(phone, 'keyword_trigger', message);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      const intent = classifyIntent(message);
      if (intent.action === 'optout') {
        return res.status(200).json({ action: 'already_opted_out' });
      }
      await supabase.from('leads')
        .update({ status: 'new', last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
      return await handleNewLead(phone, name, message, res);
    }

    return await handleExistingLead(existingLead, message, res);
  } catch (err) {
    console.error('Webhook error for', maskPhone(req.body?.phone || ''), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPayload(body) {
  if (body.response) {
    return {
      phone: body.response.from || body.response.waId,
      message: body.response.text || body.response.body || '',
      name: body.response.senderName || '',
      timestamp: body.response.timestamp
    };
  }
  return {
    phone: body.phone || body.from || body.waId || '',
    message: body.message || body.text || body.body || '',
    name: body.name || body.senderName || '',
    timestamp: body.timestamp
  };
}

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);
  const intent = classifyIntent(message);

  if (intent.action === 'optout') {
    await supabase.from('leads').insert({
      phone, name, source: 'whatsapp', status: 'dropped',
      first_msg: message, market
    });
    return res.status(200).json({ action: 'opted_out' });
  }

  const lead = {
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: message, market
  };

  if (intent.action === 'qualify') {
    lead.status = 'qualified';
    lead.program_interest = intent.program;
  }

  const { data: inserted } = await supabase.from('leads').insert(lead).select().single();

  if (intent.action === 'qualify') {
    const programName = PROGRAM_NAMES[intent.program];
    const checkoutLink = CHECKOUT_LINKS[intent.program];
    const isHinglish = market === 'IN';

    const msg = isHinglish
      ? `Perfect! ${programName} aapke liye best rahega. Yahan se enroll karo: ${checkoutLink}\n\nAur apna intake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${inserted.id}`
      : `Perfect! ${programName} would be great for you. Enroll here: ${checkoutLink}\n\nAlso fill out your intake form: https://fitnessbymaddy.com/intake?lead=${inserted.id}`;

    if (await canSendMessage(phone)) {
      await sendWhatsApp({ phone, body: msg });
    }

    return res.status(200).json({ action: 'qualified', program: intent.program });
  }

  const market_msg = market === 'IN'
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  if (await canSendMessage(phone)) {
    await sendWhatsApp({ phone, templateName: 'welcome_v1', body: market_msg });
  }

  return res.status(200).json({ action: 'welcomed', leadId: inserted.id });
}

async function handleExistingLead(lead, message, res) {
  const intent = classifyIntent(message);

  if (intent.action === 'optout') {
    await supabase.from('leads')
      .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);
    return res.status(200).json({ action: 'opted_out' });
  }

  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (intent.action === 'qualify' && lead.status === 'new') {
    await supabase.from('leads')
      .update({ status: 'qualified', program_interest: intent.program })
      .eq('id', lead.id);

    const market = detectMarket(lead.phone);
    const programName = PROGRAM_NAMES[intent.program];
    const checkoutLink = CHECKOUT_LINKS[intent.program];
    const isHinglish = market === 'IN';

    const msg = isHinglish
      ? `Great choice! ${programName} mein enroll karo: ${checkoutLink}\n\nIntake form: https://fitnessbymaddy.com/intake?lead=${lead.id}`
      : `Great choice! Enroll in ${programName}: ${checkoutLink}\n\nIntake form: https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    if (await canSendMessage(lead.phone)) {
      await sendWhatsApp({ phone: lead.phone, body: msg });
    }

    return res.status(200).json({ action: 'qualified', program: intent.program });
  }

  return res.status(200).json({ action: 'noted' });
}
