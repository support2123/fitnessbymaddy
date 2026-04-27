const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Custom', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
  { keys: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home', price: '$97' },
];

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const SITE_BASE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const text = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('keyword_trigger', phone, text.slice(0, 200));
    }

    const { data: existing } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (!existing) {
      await handleNewLead(db, phone, name, text, market, hinglish);
      return res.json({ action: 'new_lead' });
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'dropped_ignored' });
    }

    if (existing.status === 'new') {
      await handleQualification(db, existing.id, phone, text, market, hinglish);
      return res.json({ action: 'qualified' });
    }

    return res.json({ action: 'existing_lead', status: existing.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

async function handleNewLead(db, phone, name, text, market, hinglish) {
  await db.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: text, last_msg_at: new Date().toISOString(), market
  });

  const welcome = hinglish
    ? 'Hi! Maddy ki team yahan se 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp({ phone, body: welcome, templateName: 'welcome_v1' });

  scheduleNudge(phone, hinglish);
}

async function handleQualification(db, leadId, phone, text, market, hinglish) {
  const lower = text.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some(k => lower.includes(k))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    matched = PROGRAM_ROUTES[0]; // default to 6wk_gym
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', leadId);

  const checkoutUrl = `${CHECKOUT_BASE}/${matched.program}`;
  const intakeUrl = `${SITE_BASE}/intake?lead=${leadId}`;

  const msg = hinglish
    ? `Great choice! 🎯 Aapke liye perfect program: *${matched.label}* (${matched.price})\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhi fill kardo: ${intakeUrl}`
    : `Great choice! 🎯 Perfect program for you: *${matched.label}* (${matched.price})\n\nCheckout: ${checkoutUrl}\n\nPlease also fill out this form: ${intakeUrl}`;

  await sendWhatsApp({ phone, body: msg, templateName: 'program_recommendation' });
}

function scheduleNudge(phone, hinglish) {
  // Nudges handled by /api/cron/nudge-dropped
  // The cron checks leads with status='new' and nudges at 2hr / 24hr marks
}

function normalizePhone(raw) {
  let p = raw.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
