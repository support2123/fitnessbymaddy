const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { shouldEscalate, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial', try: 'zoom_trial'
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'cancel messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'fitnessbymaddy-whatsapp' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.senderPhone || payload.from || payload.waId);
    const messageBody = (payload.message || payload.text || payload.body || '').trim();

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    // Log inbound message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    // Opt-out check
    if (STOP_WORDS.some(w => messageBody.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    const escalationReason = shouldEscalate(messageBody);
    if (escalationReason) {
      await createEscalation(phone, escalationReason, messageBody);
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, messageBody, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, messageBody, res);
    }

    // Active lead/client — log and acknowledge
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, messageBody, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: messageBody,
    last_msg_at: new Date().toISOString(),
    market
  });

  // Send welcome message
  const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
  await sendTemplate(phone, templateName, []);

  // Schedule nudge (2hr) — handled by checking last_msg_at in nudge cron
  return res.status(200).json({ action: 'new_lead_welcomed', market });
}

async function handleLeadReply(db, lead, messageBody, res) {
  const lower = messageBody.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    // No keyword match — send clarifying message
    const market = lead.market || 'GLOBAL';
    const templateName = isHinglish(market) ? 'clarify_goal_hi' : 'clarify_goal';
    await sendTemplate(lead.phone, templateName, []);
    return res.status(200).json({ action: 'asked_to_clarify' });
  }

  // Update lead with program interest
  await db.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  // Send checkout link and intake form
  const checkoutUrl = CHECKOUT_URLS[matchedProgram] || CHECKOUT_URLS['zoom_trial'];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const market = lead.market || 'GLOBAL';
  const templateName = isHinglish(market) ? 'checkout_link_hi' : 'checkout_link';
  await sendTemplate(lead.phone, templateName, [checkoutUrl, intakeUrl]);

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
