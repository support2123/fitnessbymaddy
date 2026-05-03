const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logInbound, detectMarket, isHinglish, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, createEscalation } = require('./lib/escalate');
const { cors, parseBody, normalizePhone } = require('./lib/helpers');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'advanced', 'flagship', 'personal'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', name: '6-Week Home Burn', price: '$35' }
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const db = getSupabase();

  const phone = normalizePhone(body.phone || body.from || body.waId || '');
  const text = body.text || body.message || body.body || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  console.log(`WA in: ${maskPhone(phone)} — "${text.slice(0, 80)}"`);

  await logInbound(phone, text);

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    const keyword = text.toLowerCase();
    const reason = keyword.includes('refund') ? 'Refund request' :
      keyword.includes('pain') || keyword.includes('dizz') ? 'Health concern' :
      keyword.includes('pregnan') ? 'Pregnancy' :
      keyword.includes('lawyer') || keyword.includes('complaint') ? 'Complaint' :
      'Medical/safety flag';
    await createEscalation(phone, reason, text);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
  }

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  if (!existingLead) {
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market
    }).select().single();

    const welcomeMsg = hinglish
      ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! This is Maddy\'s team. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

    await sendTemplate(phone, 'welcome_v1', {
      name: body.name || 'there',
      templateParams: [body.name || 'there']
    });

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped' });
  }

  const matched = matchProgram(text);
  if (matched) {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: matched.program, last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const msg = hinglish
      ? `Great choice! ${matched.name} (${matched.price}) perfect hai aapke liye.\n\nPayment: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
      : `Great choice! ${matched.name} (${matched.price}) is perfect for you.\n\nPayment: ${checkoutUrl}\n\nPlease fill out your intake form: ${intakeUrl}`;

    await sendTemplate(phone, 'program_recommend', {
      name: existingLead.name || 'there',
      templateParams: [
        existingLead.name || 'there',
        matched.name,
        matched.price,
        checkoutUrl,
        intakeUrl
      ]
    });

    return res.status(200).json({ action: 'qualified', program: matched.program });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  return res.status(200).json({ action: 'reply_logged' });
};
