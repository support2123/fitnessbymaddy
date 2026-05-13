const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy, classifyEscalationReason } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'menopause', 'joints', '40+', 'forty', 'joint pain'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized', '12wk'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const db = getSupabase();

    await logMessage({ phone, direction: 'in', body: message, template_name: null, status: 'received' });

    const lower = message.toLowerCase().trim();

    if (STOP_WORDS.some(w => lower.includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = classifyEscalationReason(message);
      await escalateToMaddy({ reason, phone, context: message.slice(0, 200) });
      return res.status(200).json({ action: 'escalated', reason });
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
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.slice(0, 500),
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const hinglish = isHinglish(market);
  const greeting = hinglish
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Welcome to Fitness by Maddy. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a $20 trial session first?";

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: greeting,
    params: [name || 'there']
  });

  scheduleNudge(phone, lead.id, market);

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    matchedProgram = 'zoom_trial';
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const programInfo = getProgramMessage(matchedProgram, hinglish);

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    body: programInfo.message,
    params: [lead.name || 'there', programInfo.name]
  });

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function getProgramMessage(program, hinglish) {
  const programs = {
    '6wk_gym': {
      name: '6-Week Burn & Build',
      price: '$97',
      en: "Great choice! The 6-Week Burn & Build program is perfect for rapid fat loss and visible definition.\n\nPrice: $97 (one-time)\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/6wk\n\nPlease also fill your intake form: https://www.fitnessbymaddy.com/intake",
      hi: "Awesome choice! 6-Week Burn & Build program — rapid fat loss aur visible definition ke liye perfect hai.\n\nPrice: $97 (one-time)\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/6wk\n\nYe intake form bhi fill karo: https://www.fitnessbymaddy.com/intake"
    },
    'pcos': {
      name: 'PCOS Warrior',
      price: '$45',
      en: "The PCOS Warrior program is specifically designed for hormonal balance and sustainable fat loss.\n\nPrice: $45\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/pcos\n\nFill your intake form here: https://www.fitnessbymaddy.com/intake",
      hi: "PCOS Warrior program — hormonal balance aur sustainable fat loss ke liye specially designed hai.\n\nPrice: $45\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/pcos\n\nIntake form yahan fill karo: https://www.fitnessbymaddy.com/intake"
    },
    '40plus': {
      name: '40+ Strong',
      price: '$50',
      en: "40+ Strong is built for joint-friendly strength, mobility, and sustainable fitness after 40.\n\nPrice: $50\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/40plus\n\nFill your intake form: https://www.fitnessbymaddy.com/intake",
      hi: "40+ Strong program — joints ke liye safe strength training aur sustainable fitness ke liye.\n\nPrice: $50\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/40plus\n\nIntake form fill karo: https://www.fitnessbymaddy.com/intake"
    },
    '12wk': {
      name: '12-Week Flagship',
      price: '$200',
      en: "The 12-Week Flagship — Maddy's most transformative program. Fully customised training + nutrition, weekly adjustments.\n\nPrice: $200\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/12wk\n\nFill your detailed intake form: https://www.fitnessbymaddy.com/intake",
      hi: "12-Week Flagship — Maddy ka sabse transformative program. Fully customised training + nutrition, weekly adjustments.\n\nPrice: $200\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/12wk\n\nDetailed intake form fill karo: https://www.fitnessbymaddy.com/intake"
    },
    'zoom_trial': {
      name: 'Zoom Trial Session',
      price: '$20',
      en: "Start with a $20 trial Zoom session! Experience Maddy's coaching style first-hand before committing.\n\nBook here: https://fitnessbymaddyy.exlyapp.com/checkout/trial\n\nFill a quick form: https://www.fitnessbymaddy.com/intake",
      hi: "Pehle $20 trial Zoom session try karo! Maddy ka coaching style first-hand experience karo.\n\nBook karo: https://fitnessbymaddyy.exlyapp.com/checkout/trial\n\nQuick form fill karo: https://www.fitnessbymaddy.com/intake"
    }
  };

  const p = programs[program] || programs['zoom_trial'];
  return {
    name: p.name,
    message: hinglish ? p.hi : p.en
  };
}

function scheduleNudge(phone, leadId, market) {
  // Nudge scheduling is handled by the cron job /api/cron/nudge-dropped
  // which checks for leads with status='new' older than 2 hours
}

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body.phone && body.message) {
    return { phone: body.phone, message: body.message, name: body.name || null };
  }
  // Meta Cloud API webhook format
  if (body.entry) {
    const entry = body.entry[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      const contact = change.contacts?.[0];
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }
  return { phone: body.phone, message: body.message || body.text, name: body.name };
}
