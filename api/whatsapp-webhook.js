const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('./_lib/whatsapp');
const { needsEscalation, escalate } = require('./_lib/escalation');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  weight: '6wk_gym',
  shred: '6wk_gym',
  lose: '6wk_gym',
  pcos: 'pcos',
  hormonal: 'pcos',
  '40': '40plus',
  menopause: '40plus',
  joints: '40plus',
  custom: '12wk',
  '12 week': '12wk',
  serious: '12wk',
  trial: 'zoom_trial',
  zoom: 'zoom_trial',
  'not sure': 'zoom_trial',
  try: 'zoom_trial',
  home: '6wk_home',
  strength: '6wk_gym',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Session Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { message, senderPhone, senderName } = parseWebhookPayload(req.body);
    if (!senderPhone) return res.status(400).json({ error: 'No phone' });

    await logIncomingMessage(senderPhone, message);

    const optOut = /\b(stop|unsubscribe)\b/i.test(message);
    if (optOut) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', senderPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      await escalate(senderPhone, escalationReason, message);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', senderPhone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, senderPhone, senderName, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.senderPhone) {
    return {
      senderPhone: body.senderPhone,
      senderName: body.senderName || null,
      message: body.message || body.text || '',
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      senderPhone: msg?.from ? `+${msg.from}` : null,
      senderName: contact?.profile?.name || null,
      message: msg?.text?.body || '',
    };
  }
  return { senderPhone: null, senderName: null, message: '' };
}

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendWhatsApp({
    phone,
    templateName,
    bodyValues: [name || 'there'],
  });

  const program = matchProgram(message);
  if (program) {
    return await qualifyLead(db, phone, program, market, res);
  }

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(db, lead, message, res) {
  const program = matchProgram(message);
  if (!program) {
    return res.status(200).json({ action: 'awaiting_qualification' });
  }
  return await qualifyLead(db, lead.phone, program, lead.market, res);
}

async function qualifyLead(db, phone, program, market, res) {
  const { data: lead } = await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('phone', phone)
    .select()
    .single();

  const hinglish = isHinglish(market);
  const checkoutUrl = CHECKOUT_LINKS[program];
  const programName = PROGRAM_NAMES[program];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  await sendWhatsApp({
    phone,
    templateName: hinglish ? 'program_match_hi' : 'program_match_en',
    bodyValues: [programName, checkoutUrl, intakeUrl],
  });

  return res.status(200).json({ action: 'qualified', program });
}
