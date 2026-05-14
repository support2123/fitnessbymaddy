const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'slim', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20']
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const payload = req.body || {};

  const phone = payload.phone || payload.from || payload.senderPhone || '';
  const text = payload.text || payload.message || payload.body || '';

  if (!phone) return res.status(400).json({ error: 'no phone' });

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
    await notifyMaddy('Medical/escalation keyword detected', phone, text);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name: payload.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market
    }).select().single();

    const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, templateName, [payload.name || 'there']);

    return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'new') {
    const program = matchProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const market = existingLead.market || 'GLOBAL';
      if (isHinglish(market)) {
        await sendTemplate(phone, 'qualified_checkout_hi', [
          existingLead.name || 'there',
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendTemplate(phone, 'qualified_checkout', [
          existingLead.name || 'there',
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
};
