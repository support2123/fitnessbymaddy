const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Program',
  '12wk': '12-Week Flagship Program',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Session Pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from);
    const text = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const type = classifyEscalation(text);
      await notifyMaddy(
        `${type} — from ${maskPhone(phone)}`,
        `Message: "${text}"\nPhone: ${phone}\nType: ${type}`
      );
      return res.json({ action: 'escalated', type });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, text, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.json({ action: 'updated', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
  await sendTemplate(phone, templateName, [name || 'there']);

  return res.json({ action: 'new_lead', lead_id: lead.id, market });
}

async function handleQualification(lead, text, res) {
  const lower = text.toLowerCase();
  let matched = null;

  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) {
      matched = program;
      break;
    }
  }

  if (!matched) {
    return res.json({ action: 'unqualified', lead_id: lead.id });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const programName = PROGRAM_NAMES[matched] || matched;
  const hinglish = isHinglish(lead.market);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const templateName = hinglish ? 'program_offer_hi' : 'program_offer';
  await sendTemplate(lead.phone, templateName, [
    lead.name || 'there',
    programName,
    checkoutUrl,
    intakeUrl
  ]);

  return res.json({ action: 'qualified', program: matched, lead_id: lead.id });
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
