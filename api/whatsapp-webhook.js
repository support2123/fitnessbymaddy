const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalate, needsOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'advanced': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session ($20)',
  'zoom_pack': 'Zoom Session Pack'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (needsOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate('Keyword trigger in message', phone, text.slice(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, text, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'updated' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, text, res) {
  const market = detectMarket(phone);
  const { data: lead } = await supabase.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: text, market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  const matched = matchProgram(text);
  if (matched) {
    return await routeToProgram(lead, matched, res);
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(lead, text, res) {
  const matched = matchProgram(text);
  if (!matched) {
    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
    return res.status(200).json({ action: 'awaiting_qualification' });
  }
  return await routeToProgram(lead, matched, res);
}

async function routeToProgram(lead, program, res) {
  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const link = CHECKOUT_LINKS[program];
  const programName = PROGRAM_NAMES[program];
  const intakeLink = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
  const market = lead.market || detectMarket(lead.phone);

  let msg;
  if (isHinglish(market)) {
    msg = `Great choice! 🔥 Tumhare liye *${programName}* perfect hai.\n\n` +
      `👉 Checkout: ${link}\n` +
      `📝 Intake form: ${intakeLink}\n\n` +
      `Pehle form fill karo, phir payment — taaki Maddy tumhara program start se customize kar sake!`;
  } else {
    msg = `Great choice! 🔥 *${programName}* is perfect for you.\n\n` +
      `👉 Checkout: ${link}\n` +
      `📝 Intake form: ${intakeLink}\n\n` +
      `Fill the form first, then pay — so Maddy can customize your program from day one!`;
  }

  await sendText(lead.phone, msg);
  return res.status(200).json({ action: 'qualified', program });
}
