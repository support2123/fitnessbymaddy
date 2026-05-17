const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendMessage, logMessage } = require('./lib/rate-limit');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const supabase = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message);

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(supabase, phone, name, message, market, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(supabase, existingLead, message, market, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(supabase, phone, name, message, market, res) {
  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const allowed = await canSendMessage(phone);
  if (allowed) {
    const template = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, template);
    await logMessage(phone, 'out', null, template);
  }

  return res.status(200).json({ action: 'new_lead_created', lead_id: lead.id });
}

async function handleQualification(supabase, lead, message, market, res) {
  const lower = (message || '').toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    matchedProgram = 'zoom_trial';
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const allowed = await canSendMessage(lead.phone);
  if (allowed) {
    const checkoutLink = CHECKOUT_LINKS[matchedProgram];
    const intakeLink = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (isHinglish(market)) {
      await sendText(lead.phone,
        `Perfect! Tumhare liye best program mil gaya.\n\n` +
        `Checkout: ${checkoutLink}\n\n` +
        `Pehle ye form bhar do: ${intakeLink}\n\n` +
        `Any questions? Just reply here.`
      );
    } else {
      await sendText(lead.phone,
        `Great choice! Here's your program link:\n\n` +
        `Checkout: ${checkoutLink}\n\n` +
        `Please fill this form first: ${intakeLink}\n\n` +
        `Any questions? Just reply here.`
      );
    }
    await logMessage(lead.phone, 'out', 'Qualification reply + links', 'qualification_reply');
  }

  return res.status(200).json({ action: 'lead_qualified', program: matchedProgram });
}

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.payload) {
    const p = body.payload;
    return {
      phone: p.sender?.phone || p.from,
      message: p.text || p.body || p.message,
      name: p.sender?.name || p.pushName,
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change?.contacts?.[0]?.profile?.name,
      };
    }
  }
  return {
    phone: body.from || body.sender || body.phone,
    message: body.text || body.body || body.message,
    name: body.name || body.pushName,
  };
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}
