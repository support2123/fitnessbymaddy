const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, createEscalation, notifyMaddy } = require('./_lib/escalation');
const { qualifyLead, getCheckoutUrl, getProgramPrice } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const message = extractMessage(body);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;
    console.log(`Incoming from ${maskPhone(phone)}: ${text?.slice(0, 80)}`);

    await logIncomingMessage(phone, text);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: client } = await supabase
        .from('clients').select('id').eq('phone', phone).single();
      await createEscalation(phone, 'keyword_trigger', text, client?.id);
      await notifyMaddy('Keyword escalation', phone, text);
      const market = detectMarket(phone);
      const reply = isHinglish(market)
        ? 'Aapka message Maddy tak pahunch gaya hai. Woh jaldi reply karengi. 🙏'
        : 'Your message has been forwarded to Maddy. She will get back to you soon. 🙏';
      await sendWhatsApp(phone, reply, null, true);
      return res.status(200).json({ status: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      await handleNewLead(phone, text, name);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead_ignored' });
    } else if (existingLead.status === 'new') {
      await handleLeadReply(existingLead, text);
    } else if (existingLead.status === 'converted') {
      await handleClientMessage(phone, text);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_logged' });
  }
};

function extractMessage(body) {
  if (body?.phone && body?.message) {
    return { phone: body.phone, text: body.message, name: body.name || null };
  }
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];
  if (!msg) return null;
  const contact = change?.contacts?.[0];
  return {
    phone: '+' + msg.from,
    text: msg.text?.body || msg.button?.text || '',
    name: contact?.profile?.name || null
  };
}

async function handleNewLead(phone, text, name) {
  const market = detectMarket(phone);
  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcome = isHinglish(market)
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp(phone, welcome, 'welcome_v1', true);
}

async function handleLeadReply(lead, text) {
  const qualification = qualifyLead(text);
  const market = detectMarket(lead.phone);

  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: qualification?.program || lead.program_interest,
    status: qualification ? 'qualified' : 'new'
  }).eq('id', lead.id);

  if (qualification) {
    const checkoutUrl = getCheckoutUrl(qualification.program);
    const price = getProgramPrice(qualification.program);
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    const reply = isHinglish(market)
      ? `Perfect! 🎯 Aapke liye ${qualification.label} (${price}) best rahega.\n\n` +
        `✅ Checkout: ${checkoutUrl}\n` +
        `📋 Intake form bhi fill kardo: ${intakeUrl}\n\n` +
        `Payment ke baad Maddy ki team aapko onboard karegi!`
      : `Perfect! 🎯 The ${qualification.label} program (${price}) would be ideal for you.\n\n` +
        `✅ Checkout here: ${checkoutUrl}\n` +
        `📋 Also fill out this intake form: ${intakeUrl}\n\n` +
        `After payment, Maddy's team will onboard you!`;

    await sendWhatsApp(lead.phone, reply, null, true);
  } else {
    const reply = isHinglish(market)
      ? "Thanks for replying! 🙌 Kya aap bata sakte ho — fat loss, PCOS, 40+ fitness, ya custom 12-week program mein interested ho? Ya $20 trial try karna hai?"
      : "Thanks for replying! 🙌 Could you tell me — are you interested in fat loss, PCOS management, 40+ fitness, a custom 12-week program, or would you like to try a $20 trial?";

    await sendWhatsApp(lead.phone, reply, null, true);
  }
}

async function handleClientMessage(phone, text) {
  const { data: client } = await supabase
    .from('clients').select('id').eq('phone', phone).single();

  if (needsEscalation(text)) {
    await createEscalation(phone, 'client_message', text, client?.id);
    await notifyMaddy('Active client concern', phone, text);
  }

  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('phone', phone);
}

async function handleOptOut(phone) {
  await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  console.log(`Opt-out processed for ${maskPhone(phone)}`);
}
