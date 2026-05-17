const { supabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy, detectMarket, needsEscalation, isOptOut } = require('./lib/whatsapp');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const message = extractMessage(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'no_message' });
    }

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Sensitive keyword detected', `Phone: ${phone}\nMessage: ${message}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      await handleNewLead(phone, message);
    } else {
      const lead = existingLead[0];
      if (lead.status === 'dropped') {
        return res.status(200).json({ status: 'dropped_lead' });
      }
      await handleExistingLead(lead, message);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const greeting = market === 'IN'
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: greeting
  });
}

async function handleExistingLead(lead, message) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'new') {
    const qualification = qualifyLead(message);

    if (qualification) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: qualification.program
        })
        .eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const msg = lead.market === 'IN'
        ? `Great choice! 🎯 ${qualification.name} program ($${qualification.price}) — yeh tumhare liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad yeh form bhi fill karo:\n${intakeUrl}`
        : `Great choice! 🎯 The ${qualification.name} program ($${qualification.price}) is perfect for your goals.\n\nCheckout: ${checkoutUrl}\n\nAfter payment, please fill this intake form:\n${intakeUrl}`;

      await sendWhatsApp({
        phone: lead.phone,
        templateName: 'program_recommendation',
        body: msg
      });
    }
  }
}

function extractPhone(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.phone || payload?.mobile) {
    return payload.phone || payload.mobile;
  }
  if (payload?.sender?.phone) {
    return payload.sender.phone;
  }
  return null;
}

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.message || payload?.text) {
    return payload.message || payload.text;
  }
  if (payload?.body) {
    return payload.body;
  }
  return null;
}
