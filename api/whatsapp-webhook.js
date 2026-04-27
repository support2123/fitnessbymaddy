const { getSupabase } = require('./_lib/supabase');
const { detectMarket } = require('./_lib/market');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');
const { needsEscalation, createEscalation } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'dedicated', 'flagship'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const text = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    console.log(`Incoming from ${maskPhone(phone)}: ${text.substring(0, 50)}`);

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
      await createEscalation(phone, client?.id, escalationKeyword, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      return await handleLeadReply(db, existingLead, text, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const { market, lang } = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const template = lang === 'hi' ? 'welcome_v1_hi' : 'welcome_v1';
  await sendTemplate(phone, template, [name || 'there']);

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleLeadReply(db, lead, text, res) {
  const lower = text.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) {
        matched = route;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    matched = PROGRAM_ROUTES[4]; // Default to trial
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const { market } = detectMarket(lead.phone);
  const lang = market === 'IN' ? 'hi' : 'en';

  const template = lang === 'hi' ? 'program_offer_hi' : 'program_offer';
  await sendTemplate(lead.phone, template, [
    lead.name || 'there',
    matched.name,
    matched.price,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`,
  ]);

  await sendTemplate(lead.phone, 'intake_form', [
    lead.name || 'there',
    `https://fitnessbymaddy.com/intake?lead=${lead.id}`,
  ]);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function normalizePhone(raw) {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) {
    phone = '+' + phone;
  }
  return phone;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}
