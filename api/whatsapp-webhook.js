const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage, canSendMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, createEscalation, notifyMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home', price: '$97' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel', 'remove me'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.waId || '');
    const messageBody = (payload.text || payload.message || payload.body || '').trim();
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', messageBody, null);

    if (isOptOut(messageBody)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(messageBody);
    if (esc.escalate) {
      await createEscalation(phone, esc.reason, messageBody);
      await notifyMaddy(phone, esc.reason, sendText);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, messageBody, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      return await handleQualification(existingLead, messageBody, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  if (error) {
    console.error('Lead insert error:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [
        name || 'there',
        "Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      ]
    });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', {
      name: name || 'there',
      templateParams: [
        name || 'there',
        "What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
      ]
    });
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification(lead, message, res) {
  const lower = message.toLowerCase();
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    const canSend = await canSendMessage(lead.phone);
    if (canSend) {
      const market = lead.market || detectMarket(lead.phone);
      if (isHinglish(market)) {
        await sendText(lead.phone, `Thanks for your message! Kya aap fat loss, PCOS program, 40+ fitness, ya 12-week custom training mein interested ho? Ya $20 trial se start karna hai?`);
      } else {
        await sendText(lead.phone, `Thanks for your message! Are you interested in fat loss, PCOS program, 40+ fitness, or 12-week custom training? Or start with a $20 trial?`);
      }
    }
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program
    })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  let msg;
  if (isHinglish(market)) {
    msg = `${matched.name} (${matched.price}) - perfect choice!\n\nYeh raha aapka checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhi fill kar do taaki hum aapka program best tarike se customize kar sakein:\n${intakeUrl}\n\nKoi question ho toh poochho!`;
  } else {
    msg = `${matched.name} (${matched.price}) - great choice!\n\nHere's your checkout link:\n${checkoutUrl}\n\nPlease also fill out this intake form so we can customise your program:\n${intakeUrl}\n\nFeel free to ask any questions!`;
  }

  await sendText(lead.phone, msg);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

async function handleOptOut(phone) {
  await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await logMessage(phone, 'out', '[SYSTEM] Opt-out processed. No further messages.', null);
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length > 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
