const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, sendTextMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'burn': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Session Pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);
    const lower = message.toLowerCase().trim();

    await db.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in incoming message',
        phone,
        clientName: name,
        message
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, { phone, name, message, market, hinglish }, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, { message, hinglish }, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, { phone, name, message, market, hinglish }, res) {
  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcomeMsg = hinglish
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: welcomeMsg
  });

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(db, lead, { message, hinglish }, res) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    const clarifyMsg = hinglish
      ? "Got it! Thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya ek trial session se start karna hai?"
      : "Got it! Could you tell me more — are you looking for fat loss, PCOS help, 40+ fitness, or would you like to start with a trial session?";

    await sendTextMessage(lead.phone, clarifyMsg);
    return res.status(200).json({ action: 'asked_clarification' });
  }

  await db.from('leads')
    .update({
      status: 'qualified',
      program_interest: matchedProgram
    })
    .eq('id', lead.id);

  const programName = PROGRAM_NAMES[matchedProgram];
  const checkoutLink = CHECKOUT_LINKS[matchedProgram];
  const intakeLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const qualifyMsg = hinglish
    ? `Great choice! ${programName} bilkul sahi rahega tere liye.\n\nCheckout: ${checkoutLink}\n\nAur yeh intake form bhi fill kar de: ${intakeLink}\n\nKoi doubt ho toh pooch — we're here!`
    : `Great choice! ${programName} sounds perfect for you.\n\nCheckout here: ${checkoutLink}\n\nAlso fill out your intake form: ${intakeLink}\n\nAny questions? We're here to help!`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    body: qualifyMsg
  });

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function parseWebhookPayload(body) {
  if (body.mobile) {
    return {
      phone: body.mobile.startsWith('+') ? body.mobile : '+' + body.mobile,
      message: body.message || body.text || '',
      name: body.name || body.pushName || null
    };
  }

  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    if (msg) {
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null
      };
    }
  }

  return {
    phone: body.phone || body.from || null,
    message: body.message || body.text || body.body || '',
    name: body.name || null
  };
}
