const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', label: '6-Week Home Program', price: '$67' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

function classifyMessage(text) {
  const lower = (text || '').toLowerCase();

  if (STOP_WORDS.some(w => lower.includes(w))) return { action: 'opt_out' };

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return { action: 'qualify', ...route };
    }
  }

  return { action: 'unknown' };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body;
  const phone = extractPhone(payload);
  const text = extractText(payload);

  if (!phone) return res.status(200).json({ status: 'no_phone' });

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    status: 'received',
  });

  if (needsEscalation(text)) {
    await escalate(phone, 'Medical/safety flag in message', text.slice(0, 200));
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    return await handleNewLead(phone, text, res);
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ status: 'dropped_lead_ignored' });
  }

  return await handleExistingLead(existingLead, phone, text, res);
};

async function handleNewLead(phone, text, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const welcomeMsg = market === 'IN'
    ? 'welcome_v1'
    : 'welcome_v1_en';

  await sendTemplate(phone, welcomeMsg);

  return res.status(200).json({ status: 'new_lead_welcomed' });
}

async function handleExistingLead(lead, phone, text, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const classification = classifyMessage(text);

  if (classification.action === 'opt_out') {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('id', lead.id);
    return res.status(200).json({ status: 'opted_out' });
  }

  if (classification.action === 'qualify') {
    await supabase
      .from('leads')
      .update({
        status: 'qualified',
        program_interest: classification.program,
      })
      .eq('id', lead.id);

    const market = lead.market || 'IN';
    const lang = market === 'IN' ? 'hi' : 'en';

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${classification.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    const msg = lang === 'hi'
      ? `${classification.label} — perfect choice! 💪\n\nPrice: ${classification.price}\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nPayment ke baad instantly access milega!`
      : `${classification.label} — great choice! 💪\n\nPrice: ${classification.price}\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nYou'll get instant access after payment!`;

    await sendText(phone, msg);

    return res.status(200).json({ status: 'qualified', program: classification.program });
  }

  if (lead.status === 'new') {
    const market = lead.market || 'IN';
    const msg = market === 'IN'
      ? 'Koi baat nahi! Bata do — fat loss, PCOS, 40+ fitness, ya pehle ek trial try karna hai? 😊'
      : 'No worries! Let me know — fat loss, PCOS, 40+ fitness, or want to try a trial first? 😊';
    await sendText(phone, msg);
  }

  return res.status(200).json({ status: 'replied' });
}

function extractPhone(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return '+' + payload.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (payload?.phone) return payload.phone;
  if (payload?.from) return payload.from;
  if (payload?.sender?.phone) return payload.sender.phone;
  return null;
}

function extractText(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.text) return payload.text;
  if (payload?.message) return payload.message;
  if (payload?.body) return payload.body;
  return '';
}
