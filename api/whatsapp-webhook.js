const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalateToMaddy, checkOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home', price: '$35' }
];

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const { phone, message } = extractMessage(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'no_message' });
    }

    console.log(`Incoming from ${maskPhone(phone)}: ${message.substring(0, 100)}`);

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: lead } = await db.from('leads').select('name').eq('phone', phone).single();
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        name: lead?.name,
        message
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, message);
    } else if (existingLead.status === 'new') {
      await handleQualification(db, existingLead, message);
    } else if (existingLead.status === 'qualified') {
      await handleFollowUp(db, existingLead, message);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_logged' });
  }
};

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    return { phone: msg.from, message: msg.text?.body || '' };
  }

  if (payload?.phone && (payload?.message || payload?.text)) {
    return { phone: payload.phone, message: payload.message || payload.text };
  }

  if (payload?.mobile && payload?.message) {
    return { phone: payload.mobile, message: payload.message };
  }

  return { phone: null, message: null };
}

async function handleNewLead(db, phone, message) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const hinglish = isHinglish(market);

  const welcomeBody = hinglish
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: welcomeBody,
    params: { templateParams: [] }
  });
}

async function handleQualification(db, lead, message) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    const hinglish = isHinglish(lead.market);
    const clarify = hinglish
      ? "Koi baat nahi! Mujhe batao — fat loss, PCOS, 40+ fitness, ya 12-week custom program? Ya $20 Zoom trial try karo pehle."
      : "No worries! Tell me — are you looking for fat loss, PCOS support, 40+ fitness, or a full 12-week custom program? You can also try a $20 Zoom trial first.";

    await sendWhatsApp({ phone: lead.phone, body: clarify });
    return;
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matched.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const qualifyMsg = hinglish
    ? `Great choice! ${matched.label} program (${matched.price}) perfect hai tere liye.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nIntake form bhi fill karo: https://www.fitnessbymaddy.com/intake?lead=${lead.id}`
    : `Great choice! The ${matched.label} program (${matched.price}) sounds perfect for you.\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nAlso fill out the intake form: https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  await sendWhatsApp({ phone: lead.phone, body: qualifyMsg });
}

async function handleFollowUp(db, lead, message) {
  await db.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const reminder = hinglish
    ? `Checkout link: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nKoi question ho toh pooch! Maddy ki team yahan hai.`
    : `Here's your checkout link: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nAny questions? Maddy's team is here to help.`;

  await sendWhatsApp({ phone: lead.phone, body: reminder });
}
