const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, getLanguage } = require('../lib/market');
const { needsEscalation, maskPhone } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight loss': '6wk_gym', 'shred': '6wk_gym',
  'lose weight': '6wk_gym', 'fat': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'pcod': 'pcos', 'hormonal': 'pcos',
  '40+': '40plus', '40 plus': '40plus', 'menopause': '40plus', 'joints': '40plus',
  'custom': '12wk', '12 week': '12wk', '12wk': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = (payload.text || payload.body || payload.message || '').trim();
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    const lowerText = text.toLowerCase();

    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = needsEscalation(text);
    if (escalation.escalate) {
      await notifyMaddy(phone, text, escalation.reason);
      return res.status(200).json({ action: 'escalated', reason: escalation.reason });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(res, phone, name, text);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(res, existingLead, lowerText, name);
    }

    return res.status(200).json({ action: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(res, phone, name, text) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone, name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  await sendTemplate(phone, 'welcome_v1', [name || 'there']);

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(res, lead, lowerText, name) {
  const program = matchProgram(lowerText);
  if (!program) {
    return res.status(200).json({ action: 'no_match' });
  }

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
  const lang = getLanguage(lead.market || 'GLOBAL');
  const templateName = lang === 'hinglish' ? 'qualified_hinglish' : 'qualified_english';

  await sendTemplate(lead.phone, templateName, [
    name || lead.name || 'there',
    checkoutUrl,
    intakeUrl,
  ]);

  return res.status(200).json({ action: 'qualified', program });
}

function matchProgram(text) {
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (text.includes(keyword)) return program;
  }
  return null;
}

async function notifyMaddy(phone, text, reason) {
  const masked = maskPhone(phone);
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendTemplate(maddyPhone, 'escalation_alert', [
    masked,
    reason,
    text.slice(0, 200),
  ]);
}
