const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, detectMarket } = require('./_lib/whatsapp');
const { needsEscalation, escalate } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'advanced': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
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

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.waId || payload.from;
  const text = payload.text || payload.body || payload.message || '';
  const name = payload.name || payload.pushName || null;

  if (!phone) {
    return res.status(400).json({ error: 'No phone number' });
  }

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text
  });

  const lower = text.toLowerCase().trim();
  if (lower === 'stop' || lower === 'unsubscribe') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalate(phone, 'keyword_trigger', text);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name,
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    });

    const template = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
    await sendWhatsApp(phone, template, { name: name || 'there' });

    return res.status(200).json({ action: 'new_lead_greeted' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  const program = routeProgram(text);
  if (program && existingLead.status === 'new') {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const checkoutUrl = CHECKOUT_LINKS[program];
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
    const market = existingLead.market;

    const msg = market === 'IN'
      ? `Perfect! Yeh raha tumhara program link:\n${checkoutUrl}\n\nPehle yeh form bhi fill karo:\n${intakeUrl}`
      : `Perfect! Here's your program link:\n${checkoutUrl}\n\nPlease also fill this intake form:\n${intakeUrl}`;

    await sendWhatsApp(phone, 'program_link', {
      name: existingLead.name || 'there',
      templateParams: [checkoutUrl, intakeUrl]
    });

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'acknowledged' });
};
