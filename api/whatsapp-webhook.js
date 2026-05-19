const { supabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');
const { detectProgram, getProgramDetails } = require('./lib/programs');

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
    const senderName = extractName(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'ignored', reason: 'no phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, message, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, message, existingLead, res);
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
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

  const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendTemplate(phone, welcomeTemplate, [name || 'there']);

  const program = detectProgram(message);
  if (program) {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('phone', phone);

    const details = getProgramDetails(program);
    if (details) {
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.checkout_slug}`;
      await sendTemplate(phone, 'program_offer', [
        name || 'there',
        details.name,
        `$${details.price}`,
        checkoutUrl
      ]);
    }
  }

  return res.status(200).json({ status: 'new_lead_created' });
}

async function handleQualification(phone, message, lead, res) {
  const program = detectProgram(message);
  if (!program) {
    return res.status(200).json({ status: 'no_program_match' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program
  }).eq('phone', phone);

  const details = getProgramDetails(program);
  if (!details) {
    return res.status(200).json({ status: 'program_details_missing' });
  }

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.checkout_slug}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  await sendTemplate(phone, 'program_offer', [
    lead.name || 'there',
    details.name,
    `$${details.price}`,
    checkoutUrl
  ]);

  return res.status(200).json({ status: 'qualified', program });
}

function extractPhone(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.mobile) return payload.mobile;
  if (payload?.phone) return payload.phone;
  if (payload?.from) return payload.from;
  return null;
}

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.message) return payload.message;
  if (payload?.text) return payload.text;
  if (payload?.body) return payload.body;
  return null;
}

function extractName(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  if (payload?.name) return payload.name;
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}
