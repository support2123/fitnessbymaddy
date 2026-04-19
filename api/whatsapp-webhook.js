import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, isOptOut, escalateToMaddy } from '../lib/escalation.js';

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'],
  pcos: ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'menopause', 'joints', 'joint', '40+', 'forty'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  zoom_trial: ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const PROGRAM_PRICES = {
  '6wk_gym': '$97',
  '6wk_home': '$97',
  pcos: '$45',
  '40plus': '$50',
  '12wk': '$200',
  zoom_trial: '$20',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const body = extractBody(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body,
    });

    if (isOptOut(body)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await escalateToMaddy('keyword_trigger', phone, body);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, body, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, body, res);
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
}

async function handleNewLead(phone, firstMsg, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await supabase.from('leads').insert({
    phone,
    first_msg: firstMsg,
    market,
    status: 'new',
  });

  const welcome = hinglish
    ? "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai \u2014 fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here \u{1F44B} What's your goal \u2014 fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp(phone, welcome, null, true);

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(lead, body, res) {
  const lower = (body || '').toLowerCase();
  let matched = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched = program;
      break;
    }
  }

  if (!matched) {
    const hinglish = isHinglish(lead.market);
    const reply = hinglish
      ? 'Koi baat nahi! Aap apna goal bata do \u2014 fat loss, PCOS, strength, 40+ fitness, ya phir trial class try karna hai?'
      : "No worries! Just let us know your goal \u2014 fat loss, PCOS, strength, 40+ fitness, or try a trial session?";
    await sendWhatsApp(lead.phone, reply, null, true);
    return res.status(200).json({ action: 'asked_again' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const price = PROGRAM_PRICES[matched] || '';
  const hinglish = isHinglish(lead.market);
  const siteBase = process.env.SITE_URL || 'https://fitnessbymaddy.com';

  const reply = hinglish
    ? `Great choice! \u{1F4AA} Aapke liye ${formatProgram(matched)} program perfect rahega (${price}).\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${matched}\n\nApna intake form bhi fill karo: ${siteBase}/intake.html?lead=${lead.id}`
    : `Great choice! \u{1F4AA} The ${formatProgram(matched)} program is perfect for you (${price}).\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${matched}\n\nPlease fill your intake form: ${siteBase}/intake.html?lead=${lead.id}`;

  await sendWhatsApp(lead.phone, reply, null, true);

  return res.status(200).json({ action: 'qualified', program: matched });
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}

function extractPhone(payload) {
  return payload?.phone || payload?.mobile || payload?.from ||
    payload?.contacts?.[0]?.wa_id || payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id || null;
}

function extractBody(payload) {
  return payload?.message || payload?.text || payload?.body ||
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || '';
}

function formatProgram(key) {
  const map = {
    '6wk_gym': '6-Week Burn & Build',
    pcos: 'PCOS Warrior',
    '40plus': '40+ Strong',
    '12wk': '12-Week Custom Training',
    zoom_trial: 'Zoom Trial',
  };
  return map[key] || key;
}
