const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, classifyProgram, isOptOut } = require('../lib/escalation');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.mobile || body.phone || body.from);
    const text = (body.message || body.text || body.body || '').trim();
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await db.from('escalations').insert({
        phone,
        reason: escalationKeyword,
        message_body: text.slice(0, 500)
      });
      await notifyMaddy(
        `Keyword "${escalationKeyword}" detected`,
        `From: ${maskPhone(phone)}\nMsg: ${text.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return handleExistingLead(db, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);
  const programGuess = classifyProgram(text);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text.slice(0, 500),
    last_msg_at: new Date().toISOString(),
    program_interest: programGuess,
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  }

  if (programGuess) {
    return handleQualification(db, lead, programGuess, market, res);
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleExistingLead(db, lead, text, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const programGuess = classifyProgram(text);
  if (programGuess && lead.status === 'new') {
    return handleQualification(db, lead, programGuess, lead.market, res);
  }

  return res.status(200).json({ action: 'reply_logged', lead_id: lead.id });
}

async function handleQualification(db, lead, program, market, res) {
  await db.from('leads').update({
    status: 'qualified',
    program_interest: program
  }).eq('id', lead.id);

  const checkoutUrl = CHECKOUT_LINKS[program];
  const programName = PROGRAM_NAMES[program];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  let msg;
  if (isHinglish(market)) {
    msg = `${programName} — bilkul sahi choice! \n\nYeh raha checkout link:\n${checkoutUrl}\n\nAur yeh form bhi fill kardo taki Maddy tumhare liye best plan bana sake:\n${intakeUrl}`;
  } else {
    msg = `Great choice — ${programName}!\n\nHere's your checkout link:\n${checkoutUrl}\n\nPlease also fill this quick intake form so Maddy can build your perfect plan:\n${intakeUrl}`;
  }

  await sendText(lead.phone, msg);

  return res.status(200).json({ action: 'qualified', program });
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
