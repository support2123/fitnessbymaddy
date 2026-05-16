const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendMessage, logMessage } = require('./lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship'], program: '12wk', name: '12-Week Custom', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home', price: '$79' }
];

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out'];

function routeToProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;
  const phone = body.mobile || body.from || body.sender;
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number provided' });
  }

  const db = getSupabase();

  await logMessage(phone, 'in', text);

  if (OPT_OUT_WORDS.some(w => text.toLowerCase().includes(w))) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message: text.slice(0, 100) });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existingClient && existingClient.status === 'active') {
    return res.status(200).json({ action: 'active_client', note: 'Handled by support flow' });
  }

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const allowed = await canSendMessage(phone);
    if (allowed) {
      const welcomeMsg = market === 'IN'
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?';

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');
    }

    return res.status(200).json({ action: 'new_lead_created' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped', note: 'No further messages' });
  }

  const route = routeToProgram(text);
  if (route) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: route.program
    }).eq('phone', phone);

    const allowed = await canSendMessage(phone);
    if (allowed) {
      const market = existingLead.market || 'GLOBAL';
      const msg = market === 'IN'
        ? `Great choice! ${route.name} (${route.price}) perfect hai tumhare liye. Checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${route.program} aur intake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
        : `Great choice! ${route.name} (${route.price}) is perfect for you. Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${route.program} and fill the intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_recommendation', [route.name, route.price]);
      await logMessage(phone, 'out', msg, 'program_recommendation');
    }

    return res.status(200).json({ action: 'qualified', program: route.program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
