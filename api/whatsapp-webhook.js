const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' }
];

const OPT_OUT = ['stop', 'unsubscribe', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { mobile, message, name } = parseWebhookPayload(req.body);
    if (!mobile) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const lower = (message || '').toLowerCase().trim();

    await db.from('messages').insert({
      phone: mobile,
      direction: 'in',
      body: message || '',
      status: 'received'
    });

    if (OPT_OUT.some(k => lower.includes(k))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', mobile);
      return res.json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await escalateToMaddy(mobile, message, esc.reason);
    }

    const { data: existing } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', mobile)
      .limit(1)
      .single();

    if (!existing) {
      return await handleNewLead(db, mobile, name, message, res);
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existing.status === 'new') {
      return await handleQualification(db, existing.id, mobile, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);
    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (market === 'IN') {
    await sendWhatsApp(phone, 'welcome_v1', [
      name || 'there',
      'Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    ]);
  } else {
    await sendWhatsApp(phone, 'welcome_v1', [
      name || 'there',
      'What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'
    ]);
  }

  return res.json({ action: 'new_lead', id: lead?.id });
}

async function handleQualification(db, leadId, phone, message, res) {
  const lower = (message || '').toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(k => lower.includes(k))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    matched = PROGRAM_ROUTES[4]; // default to trial
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', leadId);

  const market = detectMarket(phone);
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;

  if (market === 'IN') {
    await sendWhatsApp(phone, 'program_recommendation', [
      matched.label,
      `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`,
      `Intake form bhar do: ${intakeUrl}`
    ]);
  } else {
    await sendWhatsApp(phone, 'program_recommendation', [
      matched.label,
      `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`,
      `Please fill out your intake form: ${intakeUrl}`
    ]);
  }

  return res.json({ action: 'qualified', program: matched.program });
}

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.mobile) {
    return { mobile: body.mobile, message: body.message, name: body.name };
  }

  if (body.entry) {
    try {
      const change = body.entry[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      const contact = change?.contacts?.[0];
      return {
        mobile: msg?.from,
        message: msg?.text?.body || msg?.button?.text || '',
        name: contact?.profile?.name
      };
    } catch { return {}; }
  }

  return {};
}
