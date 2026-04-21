const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { mobile, text, name } = parsePayload(req.body);
    if (!mobile || !text) return res.status(400).json({ error: 'Missing phone or text' });

    await logIncoming(mobile, text);

    if (isOptOut(text)) {
      await handleOptOut(mobile);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(mobile, 'Keyword trigger in message', text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', mobile)
      .maybeSingle();

    if (!existingLead) {
      return res.json(await handleNewLead(mobile, text, name));
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', mobile)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    if (existingLead.status === 'new') {
      return res.json(await handleQualification(existingLead, text));
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  // AiSensy webhook format
  if (body.mobile) {
    return { mobile: body.mobile, text: body.text || body.message, name: body.name };
  }
  // Meta Cloud API format (fallback)
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      mobile: msg.from,
      text: msg.text?.body || '',
      name: contact?.profile?.name,
    };
  }
  return { mobile: body.phone, text: body.message, name: body.name };
}

async function handleNewLead(phone, firstMsg, name) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      first_msg: firstMsg,
      market,
      status: 'new',
    })
    .select()
    .single();

  const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';

  await sendTemplate(phone, templateName, [name || 'there'], true);

  const route = qualifyLead(firstMsg);
  if (route) {
    return handleQualification(lead, firstMsg);
  }

  return { action: 'new_lead_welcomed', leadId: lead.id };
}

async function handleQualification(lead, message) {
  const route = qualifyLead(message);
  if (!route) return { action: 'unqualified_reply' };

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: route.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const checkoutUrl = getCheckoutUrl(route.program);
  const intakeUrl = getIntakeUrl(lead.id);

  if (isHinglish(market)) {
    await sendText(
      lead.phone,
      `Great choice! 🔥 ${route.label} program tumhare liye perfect hai.\n\n` +
      `Price: $${route.price}\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `Pehle ye form bhi fill karo taaki hum tumhara plan ready rakh sakein:\n` +
      `📋 ${intakeUrl}`,
      true
    );
  } else {
    await sendText(
      lead.phone,
      `Great choice! 🔥 The ${route.label} program is perfect for you.\n\n` +
      `Price: $${route.price}\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `Also fill out this form so we can prep your plan:\n` +
      `📋 ${intakeUrl}`,
      true
    );
  }

  return { action: 'qualified', program: route.program };
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}
