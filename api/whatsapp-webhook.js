const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, getWelcomeMessage, getQualifiedMessage } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({ reason: 'keyword_trigger', phone, message });
      return res.status(200).json({ action: 'escalated' });
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

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.payload) {
    return {
      phone: body.payload.sender?.phone || body.payload.from,
      message: body.payload.text || body.payload.body || '',
      name: body.payload.sender?.name || body.payload.pushName || null
    };
  }
  return {
    phone: body.phone || body.from || body.sender,
    message: body.message || body.text || body.body || '',
    name: body.name || body.pushName || null
  };
}

function isOptOut(message) {
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

async function handleOptOut(phone) {
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

async function handleNewLead(phone, message, name, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcome = getWelcomeMessage(market);
  await sendWhatsApp({ phone, templateName: 'welcome_v1', body: welcome, params: [name || 'there'] });

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(lead, message, res) {
  const qualification = qualifyLead(message);

  if (!qualification) {
    return res.status(200).json({ action: 'unqualified_reply' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: qualification.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const qualMsg = getQualifiedMessage(qualification, lead.market);
  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    body: qualMsg,
    params: [qualification.programName, String(qualification.price)]
  });

  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
  await sendWhatsApp({
    phone: lead.phone,
    body: `📋 Intake form: ${intakeUrl}`
  });

  return res.status(200).json({ action: 'lead_qualified', program: qualification.program });
}
