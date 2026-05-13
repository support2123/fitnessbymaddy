const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, getEscalationReason, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home'
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: 'Zoom Trial Session'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const { phone, message, name } = extractMessage(req.body);
    if (!phone || !message) return res.status(200).json({ ok: true });

    console.log(`Incoming from ${maskPhone(phone)}: ${message.slice(0, 100)}`);

    await db.from('messages').insert({
      phone, direction: 'in', body: message
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => message.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
      await escalateToMaddy({ phone, reason, messageBody: message, clientId: client?.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, message, name);
    } else if (existingLead.status === 'new') {
      await handleQualification(db, existingLead, message);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};

async function handleNewLead(db, phone, message, name) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market
  });

  const welcomeMsg = isHinglish(market)
    ? 'welcome_v1_hi'
    : 'welcome_v1_en';

  await sendWhatsApp({
    phone,
    templateName: welcomeMsg,
    params: [name || 'there']
  });
}

async function handleQualification(db, lead, message) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) return;

  await db.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram
  }).eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const checkoutUrl = CHECKOUT_URLS[matchedProgram];
  const programName = PROGRAM_NAMES[matchedProgram];
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msgEn = [
    `Great choice! The *${programName}* sounds perfect for you.`,
    '',
    `Checkout here: ${checkoutUrl}`,
    '',
    `Also fill this quick intake form so we can personalise your plan:`,
    intakeUrl
  ].join('\n');

  const msgHi = [
    `Bahut accha choice! *${programName}* aapke liye perfect rahega.`,
    '',
    `Yahan se checkout karo: ${checkoutUrl}`,
    '',
    `Aur ye quick form bhi fill karo taaki hum plan personalise kar sakein:`,
    intakeUrl
  ].join('\n');

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    body: isHinglish(market) ? msgHi : msgEn,
    params: [programName, checkoutUrl]
  });
}

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (body?.phone && body?.message) {
    return {
      phone: body.phone.startsWith('+') ? body.phone : '+' + body.phone,
      message: body.message,
      name: body.name || null
    };
  }

  return { phone: null, message: null, name: null };
}
