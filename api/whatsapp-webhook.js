const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, needsOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'weight loss': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk', 'personalized': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Flagship',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name, senderName } = parsePayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (needsOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await sendEscalation(esc.reason, phone, message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, name || senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'updated_timestamp' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await supabase.from('leads').insert({
    phone, name: name || null, source: 'whatsapp',
    status: 'new', first_msg: message, last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const welcomeBody = hinglish
    ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: welcomeBody,
    params: [name || 'there']
  });

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification(lead, message, res) {
  const lower = message.toLowerCase();
  let matchedProgram = null;

  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) {
      matchedProgram = program;
      break;
    }
  }

  if (!matchedProgram) {
    const hinglish = isHinglish(lead.market);
    const nudgeBody = hinglish
      ? 'Koi baat nahi! Aap ye options mein se choose kar sakte ho:\n1. Fat Loss (6 Week Shred)\n2. PCOS Program\n3. 40+ Fitness\n4. 12 Week Custom\n5. $20 Zoom Trial\n\nBas number ya naam likh do!'
      : 'No worries! You can choose from:\n1. Fat Loss (6 Week Shred)\n2. PCOS Program\n3. 40+ Fitness\n4. 12 Week Custom\n5. $20 Zoom Trial\n\nJust type the name or number!';

    await sendWhatsApp({
      phone: lead.phone,
      templateName: 'program_options',
      body: nudgeBody,
      params: []
    });

    return res.status(200).json({ action: 'sent_options' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: matchedProgram,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const programName = PROGRAM_NAMES[matchedProgram];
  const checkoutLink = CHECKOUT_LINKS[matchedProgram];
  const intakeLink = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;
  const hinglish = isHinglish(lead.market);

  const qualifyBody = hinglish
    ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutLink}\n\nPayment ke baad ye form fill karo taaki Maddy aapka plan bana sake:\n${intakeLink}`
    : `Great choice! ${programName} is perfect for you.\n\nCheckout here: ${checkoutLink}\n\nAfter payment, fill this intake form so Maddy can build your plan:\n${intakeLink}`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'qualified_checkout',
    body: qualifyBody,
    params: [programName, checkoutLink, intakeLink]
  });

  return res.status(200).json({ action: 'qualified', program: matchedProgram });
}

function parsePayload(body) {
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];
    return {
      phone: msg?.from ? `+${msg.from}` : null,
      message: msg?.text?.body || msg?.button?.text || '',
      name: contact?.profile?.name || null,
      senderName: null
    };
  }

  return {
    phone: body.phone || body.mobile || body.from || null,
    message: body.message || body.text || body.body || '',
    name: body.name || body.senderName || null,
    senderName: body.senderName || null
  };
}
