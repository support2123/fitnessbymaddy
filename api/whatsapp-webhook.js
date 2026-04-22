const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, getEscalationReason, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'thyroid'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior', '50'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Custom Program', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name, timestamp } = parseWebhookPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message || '',
      sent_at: timestamp || new Date().toISOString(),
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      const { data: client } = await supabase
        .from('clients').select('id').eq('phone', phone).limit(1).single();
      await createEscalation(phone, client?.id, reason, message);
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).limit(1).single();

    if (!existingLead) {
      return await handleNewLead(phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(existingLead, message, res);
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  // AiSensy webhook format
  if (body.phone) {
    return {
      phone: normalizePhone(body.phone),
      message: body.message || body.text || body.body || '',
      name: body.name || body.pushName || '',
      timestamp: body.timestamp,
    };
  }
  // Meta Cloud API format
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: normalizePhone(msg?.from || ''),
      message: msg?.text?.body || '',
      name: contact?.profile?.name || '',
      timestamp: msg?.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : null,
    };
  }
  return {};
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message || '',
    last_msg_at: new Date().toISOString(),
    market,
  });

  const templateParams = isHinglish(market)
    ? [name || 'there']
    : [name || 'there'];

  await sendWhatsApp(phone, 'welcome_v1', templateParams);

  return res.status(200).json({ action: 'new_lead_greeted', market });
}

async function handleLeadReply(lead, message, res) {
  if (!message) return res.status(200).json({ action: 'no_message' });

  const lower = message.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    matched = PROGRAM_ROUTES.find((r) => r.program === 'zoom_trial');
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const params = [
    lead.name || 'there',
    matched.label,
    matched.price,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`,
    `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`,
  ];

  await sendWhatsApp(lead.phone, 'program_offer_v1', params);

  return res.status(200).json({
    action: 'qualified',
    program: matched.program,
    label: matched.label,
  });
}
