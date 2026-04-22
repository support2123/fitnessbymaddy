const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, detectMarket } = require('./_lib/whatsapp');
const { cors } = require('./_lib/helpers');
const { needsEscalation, detectEscalationReason, escalateToMaddy } = require('./_lib/escalation');

const OPT_OUT = ['stop', 'unsubscribe', 'opt out', 'optout'];

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'over 40'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const body = req.body || {};

  const phone = body.mobile || body.phone || body.from || '';
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  await logMessage(phone, 'in', text, null);

  const lower = (text || '').toLowerCase().trim();

  if (OPT_OUT.some(kw => lower === kw || lower.startsWith(kw))) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    const reason = detectEscalationReason(text);
    await escalateToMaddy(reason, phone, text);
    return res.json({ action: 'escalated', reason });
  }

  const { data: existing } = await db
    .from('leads')
    .select('id, status, program_interest')
    .eq('phone', phone)
    .single();

  if (!existing) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market
    }).select().single();

    const welcomeParams = market === 'IN'
      ? ["Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
      : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?"];

    await sendTemplate(phone, 'welcome_v1', welcomeParams);
    return res.json({ action: 'new_lead', id: lead?.id });
  }

  if (existing.status === 'dropped') {
    return res.json({ action: 'ignored_dropped' });
  }

  const route = routeProgram(text);
  if (route) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: route.program,
      last_msg_at: new Date().toISOString()
    }).eq('id', existing.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

    const market = detectMarket(phone);
    const msg = market === 'IN'
      ? [`Great choice! ${route.label} — yeh program aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form bhi fill kar do: ${intakeUrl}`]
      : [`Great choice! ${route.label} is perfect for your goals.\n\nCheckout: ${checkoutUrl}\n\nPlease also fill out this form: ${intakeUrl}`];

    await sendTemplate(phone, 'program_recommendation', msg);
    return res.json({ action: 'qualified', program: route.program });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);
  return res.json({ action: 'message_logged' });
};
