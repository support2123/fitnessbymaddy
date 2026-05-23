const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'pcod', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'senior', '50'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await createEscalation(phone, 'Keyword trigger in message', text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    market
  }).select().single();

  const hinglish = isHinglish(market);
  await sendTemplate(phone, 'welcome_v1', {
    name: name || 'there',
    templateParams: hinglish
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a trial first?']
  });

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const lower = (text || '').toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'no_match', message: 'Could not route to program' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = CHECKOUT_URLS[matched.program];
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;
  const hinglish = isHinglish(lead.market);

  await sendTemplate(lead.phone, 'program_link', {
    name: lead.name || 'there',
    templateParams: hinglish
      ? [matched.label, checkoutUrl, intakeUrl]
      : [matched.label, checkoutUrl, intakeUrl]
  });

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function extractPhone(payload) {
  if (payload.phone) return payload.phone;
  if (payload.sender && payload.sender.phone) return payload.sender.phone;
  if (payload.contacts && payload.contacts[0]) return payload.contacts[0].wa_id;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.messages) {
      return changes[0].value.messages[0].from;
    }
  }
  return null;
}

function extractText(payload) {
  if (payload.text) return payload.text;
  if (payload.message) return payload.message;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.messages) {
      const msg = changes[0].value.messages[0];
      return msg.text ? msg.text.body : '';
    }
  }
  return '';
}

function extractName(payload) {
  if (payload.name) return payload.name;
  if (payload.sender && payload.sender.name) return payload.sender.name;
  if (payload.entry && payload.entry[0]) {
    const changes = payload.entry[0].changes;
    if (changes && changes[0] && changes[0].value && changes[0].value.contacts) {
      return changes[0].value.contacts[0].profile.name;
    }
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}
