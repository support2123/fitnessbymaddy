const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).limit(1).single();
      await createEscalation(phone, escalationReason, message, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const hinglish = isHinglishMarket(market);
  const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  const greeting = name ? name.split(' ')[0] : '';

  await sendWhatsApp(phone, templateName, [greeting]);

  return res.json({ action: 'new_lead', id: lead.id, market });
}

async function handleQualification(db, lead, message, res) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.json({ action: 'unrecognized_reply', message_logged: true });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const hinglish = isHinglishMarket(lead.market);
  const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';

  await sendWhatsApp(lead.phone, templateName, [
    matched.name,
    matched.price,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
    `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
  ]);

  return res.json({ action: 'qualified', program: matched.program });
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}
