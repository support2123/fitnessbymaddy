const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalate } = require('../lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'full program'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home' },
];

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const text = (payload.message || payload.text || payload.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'keyword_trigger', text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, text, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'acknowledged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await supabase.from('leads').insert({
    phone,
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
    source: 'whatsapp',
  });

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
    ]);
  }

  return res.json({ action: 'new_lead_welcomed' });
}

async function handleQualification(lead, text, res) {
  const lower = text.toLowerCase();
  let matched = null;

  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      matched = entry;
      break;
    }
  }

  if (!matched) {
    const hinglish = isHinglish(lead.market);
    if (hinglish) {
      await sendText(lead.phone,
        "Koi baat nahi! Batao kya chahte ho:\n1️⃣ Fat loss / Shred\n2️⃣ PCOS / Hormonal\n3️⃣ 40+ Fitness\n4️⃣ Full Custom 12-Week\n5️⃣ Zoom Trial ($20)\n\nBas number bhejo ya goal likho 💪"
      );
    } else {
      await sendText(lead.phone,
        "No worries! Tell me your goal:\n1️⃣ Fat loss / Shred\n2️⃣ PCOS / Hormonal\n3️⃣ 40+ Fitness\n4️⃣ Full Custom 12-Week\n5️⃣ Zoom Trial ($20)\n\nJust send the number or describe your goal 💪"
      );
    }
    return res.json({ action: 'clarification_sent' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const checkoutUrl = CHECKOUT_URLS[matched.program];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const hinglish = isHinglish(lead.market);
  if (hinglish) {
    await sendText(lead.phone,
      `Great choice! 🔥 ${matched.label} program perfect hai tere liye.\n\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `Payment ke baad ye form bhar dena:\n📋 ${intakeUrl}\n\n` +
      `Koi question? Bas reply karo!`
    );
  } else {
    await sendText(lead.phone,
      `Great choice! 🔥 The ${matched.label} program is perfect for you.\n\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `After payment, fill out this form:\n📋 ${intakeUrl}\n\n` +
      `Any questions? Just reply!`
    );
  }

  return res.json({ action: 'qualified', program: matched.program });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}
