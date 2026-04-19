const { getSupabase } = require('./lib/supabase');
const { sendTemplate, logMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { checkEscalation, checkOptOut, triggerEscalation } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', '50', 'fifty'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'transform', 'flagship', 'full'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'session']
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const message = (payload.message || payload.text || payload.body || '').trim();
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = checkEscalation(message);
    if (escalationReason) {
      await triggerEscalation(phone, escalationReason, message);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  scheduleNudge(phone, lead.id, market);

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    return res.status(200).json({ action: 'no_keyword_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const checkoutUrl = CHECKOUT_LINKS[matchedProgram] || CHECKOUT_LINKS['zoom_trial'];
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (isHinglish(market)) {
    await sendTemplate(lead.phone, 'program_match', [
      lead.name || 'there',
      formatProgramName(matchedProgram),
      checkoutUrl,
      intakeUrl
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_match_en', [
      lead.name || 'there',
      formatProgramName(matchedProgram),
      checkoutUrl,
      intakeUrl
    ]);
  }

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function scheduleNudge(phone, leadId, market) {
  // 2-hour nudge via delayed fetch to the nudge endpoint
  // In production, use Vercel's qstash or a similar delayed job service
  // For now, the cron/nudge-dropped endpoint handles follow-ups
}

function formatProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': '$20 Zoom Trial Session'
  };
  return names[code] || code;
}

function normalizePhone(phone) {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (!p.startsWith('+') && p.length >= 10) {
    p = '+' + p;
  }
  return p;
}
