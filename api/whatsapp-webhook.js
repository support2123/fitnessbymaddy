const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('keyword_trigger', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, message, existingLead, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, message, name, res) {
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

  const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
  await sendTemplate(phone, welcomeTemplate, [name || 'there']);

  return res.status(200).json({ action: 'new_lead_welcomed', market });
}

async function handleQualification(phone, message, lead, res) {
  const route = qualifyLead(message);

  if (!route) {
    return res.status(200).json({ action: 'unqualified_reply' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: route.program
  }).eq('phone', phone);

  const market = lead.market || detectMarket(phone);
  const checkoutLink = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
  const intakeLink = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const template = market === 'IN' ? 'program_offer_hindi' : 'program_offer';
  await sendTemplate(phone, template, [
    route.name,
    `$${route.price}`,
    checkoutLink,
    intakeLink
  ]);

  return res.status(200).json({ action: 'qualified', program: route.program });
}

function parseWebhookPayload(body) {
  if (body.message_data) {
    return {
      phone: body.message_data.from || body.phone,
      message: body.message_data.text || body.message_data.body || '',
      name: body.message_data.pushName || body.name || null
    };
  }

  return {
    phone: body.phone || body.from || body.wa_id,
    message: body.message || body.text || body.body || '',
    name: body.name || body.pushName || null
  };
}
