const { supabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, routeProgram, needsEscalation, isOptOut, maskPhone, getWelcomeMessage, getNudgeMessage } = require('../lib/helpers');

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
    const body = req.body;
    const phone = extractPhone(body);
    const message = extractMessage(body);

    if (!phone) {
      return res.status(200).json({ status: 'no_phone' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message || ''
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await sendEscalation('Keyword trigger', phone, message);
      return res.status(200).json({ status: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};

async function handleNewLead(phone, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcome = getWelcomeMessage(market);
  await sendWhatsApp({ phone, message: welcome, templateName: 'welcome_v1' });

  return res.status(200).json({ status: 'new_lead_welcomed' });
}

async function handleQualification(lead, message, res) {
  const route = routeProgram(message);
  const market = lead.market || detectMarket(lead.phone);

  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: route ? route.program : lead.program_interest,
    status: route ? 'qualified' : lead.status
  }).eq('id', lead.id);

  if (route) {
    const checkoutMsg = market === 'IN'
      ? `Great choice! ${route.name} program — $${route.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${lead.id}`
      : `Great choice! ${route.name} program — $${route.price}.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}\n\nPlease also fill the intake form: https://fitnessbymaddy.com/intake?lead=${lead.id}`;
    await sendWhatsApp({ phone: lead.phone, message: checkoutMsg });
  } else {
    const clarify = market === 'IN'
      ? "Hmm, samajh nahi aaya. Kya chahiye — fat loss, PCOS program, 40+ fitness, ya 12-week custom plan? Ya $20 trial try karo!"
      : "I'd love to help! Could you tell me more — are you looking for fat loss, PCOS support, 40+ fitness, a 12-week custom plan, or a $20 trial?";
    const allowed = await canSendMessage(lead.phone, false);
    if (allowed) {
      await sendWhatsApp({ phone: lead.phone, message: clarify });
    }
  }

  return res.status(200).json({ status: 'qualified', program: route?.program });
}

function extractPhone(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + body.entry[0].changes[0].value.messages[0].from;
  }
  if (body?.mobile || body?.phone) {
    const p = body.mobile || body.phone;
    return p.startsWith('+') ? p : '+' + p;
  }
  if (body?.from) {
    return body.from.startsWith('+') ? body.from : '+' + body.from;
  }
  return null;
}

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return body.entry[0].changes[0].value.messages[0].text.body;
  }
  return body?.message || body?.text || body?.body || '';
}
