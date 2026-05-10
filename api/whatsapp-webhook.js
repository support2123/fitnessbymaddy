const supabase = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { sendTemplate, sendText, notifyMaddy, checkRateLimit } = require('../lib/whatsapp');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');
const { matchProgram, getCheckoutUrl, getProgramName, isOptOut } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) {
      return res.status(200).json({ status: 'no_message' });
    }

    const { phone, text, name } = message;

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const type = classifyEscalation(text);
      await notifyMaddy(
        `${type} from ${maskPhone(phone)}`,
        `Message: "${text}"\nPhone: ${phone}\nType: ${type}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, text, name);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    } else if (existingLead.status === 'new') {
      await handleLeadReply(existingLead, text);
    } else if (existingLead.status === 'qualified') {
      await handleQualifiedReply(existingLead, text);
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
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (payload?.phone || payload?.mobile) {
    return {
      phone: payload.phone || payload.mobile,
      text: payload.message || payload.text || payload.body || '',
      name: payload.name || payload.customer_name || null
    };
  }

  return null;
}

async function handleNewLead(phone, text, name) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }
}

async function handleLeadReply(lead, text) {
  const program = matchProgram(text);

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (!program) {
    const canSend = await checkRateLimit(lead.phone, false);
    if (canSend) {
      if (isHinglish(lead.market)) {
        await sendText(lead.phone,
          'Hmm, samajh nahi aaya 🤔 Bata do — fat loss, PCOS, 40+ fitness, ya 12-week custom program? Ya pehle ek trial session try karna hai?'
        );
      } else {
        await sendText(lead.phone,
          "I'd love to help! Could you share your main goal? Options: fat loss, PCOS support, 40+ fitness, 12-week custom program, or a trial session to start."
        );
      }
    }
    return;
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(program);
  const programName = getProgramName(program);
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (isHinglish(lead.market)) {
    await sendText(lead.phone,
      `Perfect! 🔥 ${programName} — yeh program tere liye sahi hai!\n\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `Payment ke baad yeh form bhar dena taaki Maddy tera plan bana sake:\n` +
      `📋 ${intakeUrl}`
    );
  } else {
    await sendText(lead.phone,
      `Great choice! 🔥 The ${programName} is perfect for your goals.\n\n` +
      `👉 Checkout here: ${checkoutUrl}\n\n` +
      `After payment, fill out your intake form so Maddy can build your plan:\n` +
      `📋 ${intakeUrl}`
    );
  }
}

async function handleQualifiedReply(lead, text) {
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('phone', lead.phone)
    .eq('status', 'active')
    .single();

  if (client) return;

  const canSend = await checkRateLimit(lead.phone, false);
  if (!canSend) return;

  const checkoutUrl = getCheckoutUrl(lead.program_interest);
  if (isHinglish(lead.market)) {
    await sendText(lead.phone,
      `Hey! Tera checkout abhi pending hai 😊\n👉 ${checkoutUrl}\n\nKoi sawaal ho toh pooch — Maddy ki team yahan hai!`
    );
  } else {
    await sendText(lead.phone,
      `Hey! Your checkout is still pending 😊\n👉 ${checkoutUrl}\n\nAny questions? We're here to help!`
    );
  }
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
    .eq('phone', phone);
}
