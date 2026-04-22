const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { escalate } = require('../lib/escalation');
const {
  normalizePhone, detectMarket, classifyIntent, needsEscalation,
  isOptOut, isHinglish, cors, PROGRAM_NAMES, PROGRAM_PRICES
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const phone = normalizePhone(message.from);
    const text = message.text || '';
    const name = message.contactName || null;

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'Keyword trigger in message', text);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ status: 'active_client' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      await handleNewLead(phone, name, text);
      return res.status(200).json({ status: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    await handleExistingLead(existingLead, text);
    return res.status(200).json({ status: 'qualified' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      from: msg.from,
      text: msg.text?.body || msg.button?.text || '',
      contactName: contact?.profile?.name || null
    };
  }
  if (payload?.phone || payload?.from) {
    return {
      from: payload.phone || payload.from,
      text: payload.message || payload.text || payload.body || '',
      contactName: payload.name || payload.userName || null
    };
  }
  return null;
}

async function handleNewLead(phone, name, firstMsg) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: firstMsg ? firstMsg.slice(0, 500) : null,
    last_msg_at: new Date().toISOString(),
    market
  });

  const intent = classifyIntent(firstMsg);
  if (intent) {
    await supabase.from('leads').update({
      program_interest: intent,
      status: 'qualified'
    }).eq('phone', phone);

    await sendProgramInfo(phone, intent, market, name);
  } else {
    await sendTemplate(phone, 'welcome_v1', [], name || 'there');
  }
}

async function handleExistingLead(lead, text) {
  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const intent = classifyIntent(text);
  if (intent) {
    await supabase.from('leads').update({
      program_interest: intent,
      status: 'qualified'
    }).eq('id', lead.id);

    await sendProgramInfo(lead.phone, intent, lead.market, lead.name);
  }
}

async function sendProgramInfo(phone, program, market, name) {
  const hinglish = isHinglish(market);
  const programName = PROGRAM_NAMES[program];
  const price = PROGRAM_PRICES[program];

  let msg;
  if (hinglish) {
    msg = `${name ? name + ', ' : ''}${programName} program tere liye perfect hai! 💪\n\n` +
      `Price: $${price} (one-time)\n\n` +
      `Checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\n` +
      `Aur yeh intake form bhi fill kardo taaki hum tera program customise kar sakein:\n` +
      `https://www.fitnessbymaddy.com/intake?program=${program}&phone=${phone}`;
  } else {
    msg = `${name ? name + ', ' : ''}The ${programName} program is perfect for your goals! 💪\n\n` +
      `Price: $${price} (one-time)\n\n` +
      `Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\n` +
      `Also fill out this quick intake form so we can customise your program:\n` +
      `https://www.fitnessbymaddy.com/intake?program=${program}&phone=${phone}`;
  }

  await sendText(phone, msg);
}

async function handleOptOut(phone) {
  await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
}
