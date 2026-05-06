const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'premium': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const body = req.body;

  const phone = normalizePhone(body.mobile || body.from || body.waId || '');
  const message = (body.text || body.message || body.body || '').trim();
  const name = body.name || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  if (/^(stop|unsubscribe|opt.?out)$/i.test(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalate(phone, 'Keyword detected in message', message.slice(0, 100));
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1);

  if (!existingLead || existingLead.length === 0) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hinglish' : 'welcome_v1';
    await sendWhatsApp(phone, welcomeTemplate, { name: name || 'there' });
    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  const lead = existingLead[0];

  if (lead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = matchProgram(message);
  if (program) {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', lead.id);

    const checkoutUrl = CHECKOUT_LINKS[program];
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    const market = lead.market || detectMarket(phone);
    if (market === 'IN') {
      await sendWhatsApp(phone, 'program_link_hinglish', {
        name: lead.name || 'there',
        templateParams: [checkoutUrl, intakeUrl]
      });
    } else {
      await sendWhatsApp(phone, 'program_link', {
        name: lead.name || 'there',
        templateParams: [checkoutUrl, intakeUrl]
      });
    }
    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};

function normalizePhone(phone) {
  return phone.replace(/[\s\-\+\(\)]/g, '');
}

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}
