const { getClient } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { detectProgram, PROGRAM_NAMES } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getClient();

  try {
    const { phone, message, name, timestamp } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `From ${maskPhone(phone)}: "${message.slice(0, 100)}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const templateName = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendTemplate(phone, templateName, {
    name: name || 'there',
    templateParams: [name || 'there']
  });

  return res.status(200).json({ action: 'new_lead_greeted', market });
}

async function handleQualification(db, lead, message, res) {
  const program = detectProgram(message);
  if (!program) {
    return res.status(200).json({ action: 'no_program_match' });
  }

  await db.from('leads')
    .update({
      status: 'qualified',
      program_interest: program
    })
    .eq('id', lead.id);

  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  await sendTemplate(lead.phone, 'program_match', {
    name: lead.name || 'there',
    templateParams: [lead.name || 'there', programName, checkoutUrl, intakeUrl]
  });

  return res.status(200).json({ action: 'qualified', program });
}

function parseWebhookPayload(body) {
  if (!body) return {};
  // AiSensy webhook format
  if (body.phone && body.message) {
    return {
      phone: body.phone,
      message: body.message,
      name: body.name || body.pushName || null,
      timestamp: body.timestamp || null
    };
  }
  // Meta Cloud API format (fallback)
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: contact?.profile?.name || null,
        timestamp: msg.timestamp
      };
    }
  }
  return {};
}
