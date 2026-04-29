const { supabase } = require('../lib/supabase');
const { sendTemplate, sendSessionMessage, notifyMaddy, logMessage } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, needsEscalation, isOptOut, getGreeting, maskPhone } = require('../lib/utils');

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
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(200).json({ ok: true, skipped: 'no_message' });
    }

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Escalation keyword detected', `Phone: ${maskPhone(phone)}\nMessage: ${message}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, message, name);
      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      await handleQualification(existingLead, message);
      return res.status(200).json({ ok: true, action: 'qualified' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ ok: true, action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'processed_with_error' });
  }
};

function parseWebhookPayload(body) {
  if (body.phone && body.message) {
    return {
      phone: normalizePhone(body.phone),
      message: body.message,
      name: body.name || null
    };
  }

  if (body.entry) {
    try {
      const changes = body.entry[0]?.changes[0]?.value;
      const msg = changes?.messages?.[0];
      if (msg) {
        return {
          phone: normalizePhone(msg.from),
          message: msg.text?.body || msg.button?.text || '',
          name: changes?.contacts?.[0]?.profile?.name || null
        };
      }
    } catch (e) { /* fall through */ }
  }

  return { phone: null, message: null, name: null };
}

function normalizePhone(phone) {
  let clean = phone.replace(/[\s\-()]/g, '');
  if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

async function handleNewLead(phone, message, name) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const greeting = getGreeting(market);
  await sendTemplate(phone, 'welcome_v1', {
    name: name || 'there',
    templateParams: [name || 'there']
  });

  const intent = classifyIntent(message);
  if (intent) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (lead) {
      await routeToProgram(lead, phone, intent, market);
    }
  }
}

async function handleQualification(lead, message) {
  const intent = classifyIntent(message);
  if (!intent) {
    const market = lead.market || detectMarket(lead.phone);
    if (market === 'IN') {
      await sendSessionMessage(lead.phone, 'Koi baat nahi! Batao kya goal hai - fat loss, PCOS, strength, 40+ fitness, ya trial try karna hai?');
    } else {
      await sendSessionMessage(lead.phone, 'No worries! What\'s your main goal - fat loss, PCOS management, strength, 40+ fitness, or would you like to start with a trial?');
    }
    return;
  }

  await routeToProgram(lead, lead.phone, intent, lead.market);
}

async function routeToProgram(lead, phone, intent, market) {
  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: intent.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const isIN = market === 'IN';
  const msg = isIN
    ? `Great choice! ${intent.label} program tere liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad ye form bhi fill karo:\n${intakeUrl}`
    : `Great choice! The ${intent.label} program is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nAfter payment, please fill this form:\n${intakeUrl}`;

  await sendTemplate(phone, 'program_recommendation', {
    templateParams: [intent.label, `$${intent.price}`, checkoutUrl, intakeUrl]
  });
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}
