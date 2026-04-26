const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'above 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { senderPhone, message, senderName } = parseWebhookPayload(req.body);
  if (!senderPhone) return res.status(400).json({ error: 'Invalid payload' });

  await logMessage(senderPhone, 'in', message || '');

  if (STOP_WORDS.some(w => (message || '').toLowerCase().includes(w))) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', senderPhone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message || '')) {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', senderPhone)
      .single();
    await escalateToMaddy(
      `Message contains escalation keyword`,
      lead || { phone: senderPhone, name: senderName }
    );
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', senderPhone)
    .single();

  if (!existingLead) {
    return await handleNewLead(senderPhone, senderName, message, res);
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    return await handleQualification(existingLead, message, res);
  }

  return res.status(200).json({ action: 'no_action' });
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const hinglish = isHinglish(market);
  const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';

  const allowed = await canSendMessage(phone);
  if (allowed) {
    await sendTemplate(phone, welcomeTemplate, [name || 'there']);
    await logMessage(phone, 'out', `[template:${welcomeTemplate}]`, welcomeTemplate);
  }

  return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
}

async function handleQualification(lead, message, res) {
  const program = matchProgram(message || '');

  if (!program) {
    return res.status(200).json({ action: 'no_match', lead_id: lead.id });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglish(market);
  const programName = PROGRAM_NAMES[program] || program;

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';
  const allowed = await canSendMessage(lead.phone);
  if (allowed) {
    await sendTemplate(lead.phone, templateName, [
      lead.name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
    await logMessage(lead.phone, 'out', `[template:${templateName}] ${programName}`, templateName);
  }

  return res.status(200).json({ action: 'qualified', program, lead_id: lead.id });
}

function parseWebhookPayload(body) {
  if (body.senderPhone) {
    return {
      senderPhone: body.senderPhone,
      message: body.message || body.text || '',
      senderName: body.senderName || body.pushName || '',
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      senderPhone: msg?.from || '',
      message: msg?.text?.body || '',
      senderName: contact?.profile?.name || '',
    };
  }
  return { senderPhone: null, message: '', senderName: '' };
}
