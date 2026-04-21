const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, canSendMessage, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getLanguage } = require('../lib/market');
const { checkEscalation, triggerEscalation } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'burn fat': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk',
  '12wk': '12wk', 'flagship': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial',
  'try': 'zoom_trial',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = normalizePhone(extractPhone(body));
    const messageBody = extractMessage(body);

    if (!phone) {
      return res.status(200).json({ ok: true, skipped: 'no phone' });
    }

    await logMessage(phone, 'in', messageBody, null);

    if (isOptOut(messageBody)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(messageBody);
    if (escalationKeyword) {
      await triggerEscalation(phone, messageBody, escalationKeyword);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ ok: true, action: 'active_client_message' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, messageBody, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    return await handleLeadReply(existingLead, messageBody, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal' });
  }
};

async function handleNewLead(phone, messageBody, res) {
  const market = detectMarket(phone);
  const lang = getLanguage(market);

  await supabase.from('leads').insert({
    phone,
    first_msg: messageBody,
    last_msg_at: new Date().toISOString(),
    market,
    status: 'new',
  });

  if (lang === 'hinglish') {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?",
    ]);
  }

  return res.status(200).json({ ok: true, action: 'new_lead_greeted' });
}

async function handleLeadReply(lead, messageBody, res) {
  if (!messageBody) {
    return res.status(200).json({ ok: true, action: 'empty_message' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = matchProgram(messageBody);
  if (!program) {
    return res.status(200).json({ ok: true, action: 'no_program_match' });
  }

  const allowed = await canSendMessage(lead.phone, false);
  if (!allowed) {
    return res.status(200).json({ ok: true, action: 'rate_limited' });
  }

  await supabase
    .from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  const lang = getLanguage(lead.market);
  const programName = PROGRAM_NAMES[program];
  const checkoutLink = CHECKOUT_LINKS[program];
  const intakeLink = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  let msg;
  if (lang === 'hinglish') {
    msg = `Great choice! 💪 ${programName} aapke liye perfect hai.\n\nYahan se enroll karo:\n${checkoutLink}\n\nAur yeh intake form bhi fill kardo taaki hum aapka program customize kar sakein:\n${intakeLink}`;
  } else {
    msg = `Great choice! 💪 ${programName} is perfect for you.\n\nEnroll here:\n${checkoutLink}\n\nAlso fill out this intake form so we can customise your program:\n${intakeLink}`;
  }

  await sendTextMessage(lead.phone, msg);

  return res.status(200).json({ ok: true, action: 'qualified', program });
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower.includes('stop messaging');
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function extractPhone(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return body.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (body?.phone) return body.phone;
  if (body?.from) return body.from;
  if (body?.sender?.phone) return body.sender.phone;
  return null;
}

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return body.entry[0].changes[0].value.messages[0].text.body;
  }
  if (body?.message) return body.message;
  if (body?.text) return body.text;
  if (body?.body) return body.body;
  return null;
}
