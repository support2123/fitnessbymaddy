const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Burn', price: '$97' }
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel messages'];

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

    const { phone, text, name } = message;
    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (OPT_OUT_KEYWORDS.some(k => text.toLowerCase().includes(k))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(text);
    if (escalationTrigger) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();
      await escalate(phone, escalationTrigger, text, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ ok: true, action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
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

  return res.status(200).json({ ok: true, action: 'new_lead', lead_id: lead?.id });
}

async function handleQualification(db, lead, text, res) {
  const lower = text.toLowerCase();

  let matched = null;
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(k => lower.includes(k))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    const market = lead.market || detectMarket(lead.phone);
    if (isHinglish(market)) {
      await sendText(lead.phone,
        'Thoda aur bata do — kya goal hai?\n\n' +
        '1. Fat loss / Weight loss\n' +
        '2. PCOS / Hormonal\n' +
        '3. 40+ Fitness\n' +
        '4. 12-Week Custom Program\n' +
        '5. Trial session pehle try karein\n\n' +
        'Bas number ya goal likh do!'
      );
    } else {
      await sendText(lead.phone,
        'Tell me more about your goal:\n\n' +
        '1. Fat loss / Weight loss\n' +
        '2. PCOS / Hormonal balance\n' +
        '3. 40+ Fitness\n' +
        '4. 12-Week Custom Program\n' +
        '5. Try a trial session first\n\n' +
        'Just type the number or your goal!'
      );
    }
    return res.status(200).json({ ok: true, action: 'awaiting_goal' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const market = lead.market || detectMarket(lead.phone);
  if (isHinglish(market)) {
    await sendText(lead.phone,
      `Great choice! ${matched.name} (${matched.price}) — yeh program aapke liye perfect hai.\n\n` +
      `Checkout karein: ${checkoutUrl}\n\n` +
      `Aur yeh form bhi fill kar dein taaki hum aapka plan customize kar sakein:\n${intakeUrl}`
    );
  } else {
    await sendText(lead.phone,
      `Great choice! ${matched.name} (${matched.price}) is perfect for your goals.\n\n` +
      `Complete checkout: ${checkoutUrl}\n\n` +
      `Also fill out this quick form so we can customize your plan:\n${intakeUrl}`
    );
  }

  return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
}

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (payload?.phone && payload?.message) {
    return {
      phone: payload.phone.startsWith('+') ? payload.phone : '+' + payload.phone,
      text: payload.message || '',
      name: payload.name || null
    };
  }

  return null;
}
