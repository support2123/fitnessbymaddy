const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendRateLimited, notifyMaddy, logMessage } = require('./_lib/whatsapp');
const { checkEscalation } = require('./_lib/escalation');
const { detectMarket, normalizePhone, maskPhone } = require('./_lib/phone');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home', price: '$35' }
];

const OPT_OUT = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', webhook: 'whatsapp' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = normalizePhone(body.mobile || body.phone || body.from || '');
    const messageBody = (body.message || body.text || body.body || '').trim();
    const senderName = body.name || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logMessage(phone, 'in', messageBody, null);

    const lower = messageBody.toLowerCase();

    if (OPT_OUT.some(kw => lower === kw || lower === kw.replace(' ', ''))) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = checkEscalation(messageBody);
    if (esc.escalate) {
      await notifyMaddy(
        'Message requires review',
        `From: ${maskPhone(phone)}\nTriggers: ${esc.triggers.join(', ')}\nMessage: ${messageBody.slice(0, 200)}`
      );
    }

    const supabase = getSupabase();
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(supabase, phone, messageBody, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(supabase, existingLead, messageBody, res);
    }

    return res.status(200).json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(supabase, phone, messageBody, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await sendTemplate(phone, 'welcome_v1', welcomeParams);

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(supabase, lead, messageBody, res) {
  const lower = messageBody.toLowerCase();

  let matched = null;
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'no_match', status: 'awaiting_clarification' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const isIN = market === 'IN';

  const programMsg = isIN
    ? `Great choice! ${matched.label} program (${matched.price}) aapke liye perfect hai. Checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id} \n\nOnboarding form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${lead.id}`
    : `Great choice! The ${matched.label} program (${matched.price}) is perfect for you. Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id} \n\nAlso fill out your onboarding form: https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  await sendRateLimited(lead.phone, 'program_recommendation', [programMsg]);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

async function handleOptOut(phone) {
  const supabase = getSupabase();
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}
