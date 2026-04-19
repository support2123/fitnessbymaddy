const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'belly'], program: '6wk_gym', template: 'program_6wk' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', template: 'program_pcos' },
  fortyplus: { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'aging'], program: '40plus', template: 'program_40plus' },
  flagship: { keywords: ['custom', '12 week', '12week', 'serious', 'transform', 'complete', 'full'], program: '12wk', template: 'program_12wk' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'], program: 'zoom_trial', template: 'program_trial' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.senderPhone || payload.from || payload.waId);
    const text = (payload.text || payload.message || payload.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage({ phone, direction: 'in', body: text, template_name: null, status: 'received' });

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({ reason: 'Keyword trigger', phone, message: text });
    }

    const db = getSupabase();
    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', note: 'Forwarded to support queue' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_re-engaged' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      return await handleLeadReply(db, existingLead, text, res);
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const hinglish = isHinglish(market);
  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: hinglish
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'],
  });

  return res.status(200).json({ action: 'new_lead_welcomed', leadId: lead.id });
}

async function handleLeadReply(db, lead, text, res) {
  const lower = text.toLowerCase();
  let matched = null;

  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      matched = { key, ...route };
      break;
    }
  }

  if (!matched) {
    return res.status(200).json({ action: 'unmatched_reply', text });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);

  await sendWhatsApp({
    phone: lead.phone,
    templateName: matched.template,
    bodyValues: [
      lead.name || 'there',
      hinglish
        ? 'Yeh raha aapka program link 👇 Payment ke baad turant onboarding start ho jayegi!'
        : 'Here\'s your program link 👇 Onboarding starts instantly after payment!',
      `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
      `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`,
    ],
  });

  return res.status(200).json({ action: 'qualified', program: matched.program, leadId: lead.id });
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
