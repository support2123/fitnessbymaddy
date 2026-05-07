const supabase = require('./_lib/supabase');
const { sendWhatsApp, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { checkEscalation, escalate } = require('./_lib/escalation');

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  fortyplus: { keywords: ['40', 'forty', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', name: '40+ Strong' },
  flagship: { keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'advanced'], program: '12wk', name: '12-Week Flagship' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', name: '$20 Zoom Trial' }
};

const PROGRAM_PRICES = {
  '6wk_gym': 97, '6wk_home': 97, pcos: 45, '40plus': 50, '12wk': 200, zoom_trial: 20, zoom_pack: 20
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ ok: true });

    const { phone, body, name } = message;
    await logIncoming(phone, body);

    const lower = (body || '').toLowerCase().trim();

    if (STOP_WORDS.some(w => lower === w || lower.includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(body);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, body);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, body, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_ignored' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, body, res);
    }

    return res.status(200).json({ ok: true, action: 'existing_lead' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

function extractMessage(payload) {
  if (payload?.message && payload?.phone) {
    return { phone: payload.phone, body: payload.message, name: payload.name || null };
  }
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  if (msg) {
    const contact = change?.contacts?.[0];
    return {
      phone: msg.from,
      body: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }
  return null;
}

async function handleNewLead(phone, body, name, res) {
  const market = detectMarket(phone);
  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: body,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcome = isHinglishMarket(market)
    ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp(phone, welcome, 'welcome_v1', true);
  return res.status(200).json({ ok: true, action: 'new_lead_welcomed' });
}

async function handleQualification(lead, body, res) {
  const lower = (body || '').toLowerCase();
  let matched = null;

  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = { key, ...route };
      break;
    }
  }

  if (!matched) {
    const market = lead.market || 'GLOBAL';
    const reply = isHinglishMarket(market)
      ? 'Thoda aur batao — kya goal hai tumhara? Fat loss, PCOS, 40+ fitness, ya 12-week custom program?'
      : 'Could you tell me more about your goal? We have programs for fat loss, PCOS, 40+ fitness, or a full 12-week custom program.';
    await sendWhatsApp(lead.phone, reply, null, true);
    return res.status(200).json({ ok: true, action: 'asked_again' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matched.program
  }).eq('id', lead.id);

  const price = PROGRAM_PRICES[matched.program] || 0;
  const market = lead.market || 'GLOBAL';
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const msg = isHinglishMarket(market)
    ? `${matched.name} — perfect choice! Price: $${price}\n\nCheckout: ${checkoutUrl}\n\nSaath mein ye form bhi fill karo:\n${intakeUrl}`
    : `${matched.name} — great choice! Price: $${price}\n\nCheckout here: ${checkoutUrl}\n\nAlso fill out your intake form:\n${intakeUrl}`;

  await sendWhatsApp(lead.phone, msg, null, true);
  return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
}
