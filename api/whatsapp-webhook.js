const supabase = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../lib/market');
const { checkEscalation, escalateToMaddy } = require('../lib/escalation');
const { detectProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES } = require('../lib/qualify');

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
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalationTrigger = checkEscalation(text);
    if (escalationTrigger) {
      await escalateToMaddy(escalationTrigger, phone, text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'lead_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, text, res);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ status: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};

async function handleNewLead(phone, text, name, res) {
  const market = detectMarket(phone);
  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglishMarket(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there'], name || '');
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there'], name || '');
  }

  return res.status(200).json({ status: 'new_lead', id: lead.id });
}

async function handleQualification(lead, text, res) {
  const program = detectProgram(text);
  if (!program) {
    return res.status(200).json({ status: 'awaiting_qualification' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const programName = PROGRAM_NAMES[program];
  const price = PROGRAM_PRICES[program];
  const market = lead.market;

  const checkoutUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/' + program;
  const intakeUrl = 'https://fitnessbymaddy.com/intake.html?lead=' + lead.id;

  if (isHinglishMarket(market)) {
    await sendTemplate(lead.phone, 'program_offer', [
      lead.name || 'there',
      programName,
      '$' + price,
      checkoutUrl
    ], lead.name || '');
  } else {
    await sendTemplate(lead.phone, 'program_offer_en', [
      lead.name || 'there',
      programName,
      '$' + price,
      checkoutUrl
    ], lead.name || '');
  }

  return res.status(200).json({ status: 'qualified', program });
}

function extractMessage(payload) {
  if (payload.entry) {
    const entry = payload.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const value = changes && changes.value;
    if (!value || !value.messages || !value.messages[0]) return null;
    const msg = value.messages[0];
    const contact = value.contacts && value.contacts[0];
    return {
      phone: msg.from,
      text: msg.text ? msg.text.body : '',
      name: contact ? contact.profile.name : ''
    };
  }

  if (payload.message || payload.text) {
    return {
      phone: payload.from || payload.sender || payload.phone || '',
      text: payload.message || payload.text || payload.body || '',
      name: payload.name || payload.userName || ''
    };
  }

  return null;
}
