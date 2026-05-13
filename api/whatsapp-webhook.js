const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', lose: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos', hormone: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus', joint: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', advanced: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial', try: 'zoom_trial'
};

const PROGRAM_CHECKOUT = {
  '6wk_gym': 'sixweek-gym',
  '6wk_home': 'sixweek-home',
  pcos: 'pcos-warrior',
  '40plus': '40plus-strong',
  '12wk': 'twelve-week-flagship',
  zoom_trial: 'zoom-trial',
  zoom_pack: 'zoom-pack'
};

function classifyMessage(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (lower === 'stop' || lower === 'unsubscribe') return { action: 'optout' };

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return { action: 'qualify', program };
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, message, name } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await supabase.from('messages').insert({
    phone, direction: 'in', body: message
  });

  if (needsEscalation(message)) {
    await escalateToMaddy('Medical/safety keyword detected in lead message', {
      phone, details: message
    });
  }

  const classification = classifyMessage(message);

  if (classification?.action === 'optout') {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`[OPT-OUT] ${maskPhone(phone)} unsubscribed`);
    return res.status(200).json({ action: 'optout' });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    });

    const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, [name || 'there']);

    return res.status(200).json({ action: 'new_lead', market });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (classification?.action === 'qualify' && existingLead.status === 'new') {
    const program = classification.program;
    const checkoutSlug = PROGRAM_CHECKOUT[program] || 'twelve-week-flagship';
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    await supabase.from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const templateName = hinglish ? 'qualify_offer_hi' : 'qualify_offer';
    await sendTemplate(phone, templateName, [
      name || existingLead.name || 'there',
      program,
      checkoutUrl,
      intakeUrl
    ]);

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
