const { getSupabase } = require('./lib/supabase');
const { sendRateLimited, sendText, logMessage, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { checkEscalation, checkOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'patla', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40+', '40 plus', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personal', 'personalised'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'pehle', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session' }
];

function parseIncoming(body) {
  if (body.entry) {
    const change = body.entry[0]?.changes?.[0]?.value;
    if (!change?.messages?.[0]) return null;
    const msg = change.messages[0];
    const contact = change.contacts?.[0];
    return {
      phone: msg.from,
      message: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || ''
    };
  }
  return {
    phone: body.phone || body.mobile || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || body.userName || ''
  };
}

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-custom',
    'zoom_trial': 'zoom-trial'
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const incoming = parseIncoming(req.body);
    if (!incoming || !incoming.phone) {
      return res.status(200).json({ status: 'no_message' });
    }

    const { phone, message, name } = incoming;
    const db = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await sendText(phone, 'You have been unsubscribed. We will not send further messages. Take care!');
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalationHits = checkEscalation(message);
    if (escalationHits) {
      await notifyMaddy(
        'Escalation keywords detected',
        `Phone: ${maskPhone(phone)}\nKeywords: ${escalationHits.join(', ')}\nMessage: ${message.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (isHinglish(market)) {
        await sendRateLimited(phone, 'welcome_v1', [name || 'there'], name);
      } else {
        await sendRateLimited(phone, 'welcome_v1_en', [name || 'there'], name);
      }

      return res.status(200).json({ status: 'new_lead', id: newLead?.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ status: 'active_client' });
    }

    const matched = matchProgram(message);
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program
      }).eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(matched.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const market = existingLead.market || 'GLOBAL';

      let msg;
      if (isHinglish(market)) {
        msg = `Great choice! 🔥 ${matched.label} perfect hai tere liye.\n\n` +
          `👉 Payment link: ${checkoutUrl}\n\n` +
          `Payment ke baad ye form fill karo taaki hum tera program customize kar sakein:\n` +
          `📋 ${intakeUrl}\n\n` +
          `Koi question? Bas reply karo!`;
      } else {
        msg = `Great choice! 🔥 ${matched.label} is perfect for you.\n\n` +
          `👉 Payment link: ${checkoutUrl}\n\n` +
          `After payment, fill this form so we can customize your program:\n` +
          `📋 ${intakeUrl}\n\n` +
          `Questions? Just reply here!`;
      }

      await sendText(phone, msg);
      return res.status(200).json({ status: 'qualified', program: matched.program });
    }

    return res.status(200).json({ status: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};
