const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'above 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample', '$20']
};

const CHECKOUT_MAP = {
  '6wk_gym': '6wk-shred',
  '6wk_home': '6wk-home',
  'pcos': 'pcos-warrior',
  '40plus': '40plus-strong',
  '12wk': '12wk-custom',
  'zoom_trial': 'zoom-trial',
  'zoom_pack': 'zoom-pack'
};

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  let phone, messageBody, senderName;

  try {
    const body = req.body;

    // AiSensy webhook format
    if (body.phone || body.mobile) {
      phone = body.phone || body.mobile;
      messageBody = body.message || body.text || body.body || '';
      senderName = body.name || body.pushName || null;
    }
    // Meta Cloud API webhook format
    else if (body.entry) {
      const entry = body.entry[0];
      const change = entry?.changes?.[0];
      const msg = change?.value?.messages?.[0];
      if (!msg) return res.status(200).json({ status: 'no_message' });
      phone = msg.from;
      messageBody = msg.text?.body || msg.body || '';
      senderName = change.value.contacts?.[0]?.profile?.name || null;
    } else {
      return res.status(200).json({ status: 'unknown_format' });
    }
  } catch (err) {
    console.error('Webhook parse error:', err.message);
    return res.status(200).json({ status: 'parse_error' });
  }

  if (!phone) return res.status(200).json({ status: 'no_phone' });

  // Normalize phone
  phone = phone.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;

  // Log incoming message
  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: messageBody,
    status: 'received'
  });

  // Check opt-out
  if (isOptOut(messageBody)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ status: 'opted_out' });
  }

  // Check escalation
  const esc = needsEscalation(messageBody);
  if (esc.escalate) {
    await notifyMaddy(
      'Escalation Required',
      `Phone: ${maskPhone(phone)}\nMessage: ${messageBody}\nTriggers: ${esc.reasons.join(', ')}`
    );
  }

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  // Check if existing lead
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  // Check if existing client
  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    // Active client messaging — just log, don't auto-reply
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
    return res.status(200).json({ status: 'active_client_message_logged' });
  }

  if (!existingLead) {
    // New lead — Flow A
    await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market
    });

    const welcomeBody = hinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a $20 trial session first?";

    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      body: welcomeBody,
      params: [senderName || 'there']
    });

    return res.status(200).json({ status: 'new_lead_welcomed' });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ status: 'lead_dropped_no_action' });
  }

  // Update last message time
  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    name: existingLead.name || senderName
  }).eq('id', existingLead.id);

  // Flow B — Lead qualification
  const program = matchProgram(messageBody);
  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', existingLead.id);

    const checkoutSlug = CHECKOUT_MAP[program] || program;
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    let qualifyBody;
    if (hinglish) {
      qualifyBody = `Perfect! Aapke liye best program mil gaya 🎯\n\nCheckout: ${checkoutUrl}\n\nAur yeh intake form bhi fill kar do:\n${intakeUrl}\n\nKoi bhi question ho, poochh lo!`;
    } else {
      qualifyBody = `Great choice! Here's what's next 🎯\n\nCheckout: ${checkoutUrl}\n\nPlease also fill out this quick intake form:\n${intakeUrl}\n\nFeel free to ask any questions!`;
    }

    await sendWhatsApp({
      phone,
      body: qualifyBody,
      templateName: 'program_match'
    });

    return res.status(200).json({ status: 'lead_qualified', program });
  }

  return res.status(200).json({ status: 'message_logged' });
};
