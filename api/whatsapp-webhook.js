const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const { qualifyLead, isOptOut } = require('./lib/qualify');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('keyword_trigger', phone, message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return await handleExistingLead(existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const templateName = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendWhatsApp({
    phone,
    templateName,
    bodyValues: [name || 'there'],
  });

  return res.status(200).json({ action: 'new_lead_greeted', market });
}

async function handleExistingLead(lead, message, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const qualification = qualifyLead(message);

    if (qualification) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: qualification.programId,
        })
        .eq('id', lead.id);

      const market = lead.market || 'IN';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${qualification.checkoutPath}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      const templateName = market === 'IN' ? 'program_offer_hi' : 'program_offer_en';
      await sendWhatsApp({
        phone: lead.phone,
        templateName,
        bodyValues: [qualification.name, `$${qualification.price}`, checkoutUrl, intakeUrl],
      });

      return res.status(200).json({ action: 'qualified', program: qualification.programId });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
}

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.phone && body.message) {
    return { phone: body.phone, message: body.message, name: body.name };
  }

  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (msg) {
      const contact = changes?.contacts?.[0];
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || '',
      };
    }
  }

  if (body.response) {
    return {
      phone: body.response?.phone || body.phone_number,
      message: body.response?.message || body.message,
      name: body.response?.name || '',
    };
  }

  return {};
}
