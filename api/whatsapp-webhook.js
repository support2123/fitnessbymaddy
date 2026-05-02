const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, needsEscalation, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { matchProgram, getProgramDetails } = require('./lib/programs');

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
    const name = extractName(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'no_message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (message.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Keyword escalation', { phone, message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(phone, name, message);
    } else if (existingLead.status === 'new') {
      await handleQualification(existingLead, message);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    return res.status(200).json({ status: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_logged' });
  }
};

async function handleNewLead(phone, name, message) {
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

  const welcomeParams = market === 'IN'
    ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?'];

  await sendTemplate(phone, 'welcome_v1', welcomeParams);
}

async function handleQualification(lead, message) {
  const programKey = matchProgram(message);

  if (!programKey) {
    return;
  }

  const details = getProgramDetails(programKey);

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: programKey,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const market = lead.market || 'IN';
  const params = market === 'IN'
    ? [details.name, `$${details.price}`, checkoutUrl, intakeUrl]
    : [details.name, `$${details.price}`, checkoutUrl, intakeUrl];

  await sendTemplate(lead.phone, 'program_offer', params);
}

function extractPhone(payload) {
  if (payload?.phone) return payload.phone;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return '+' + payload.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (payload?.mobile) return payload.mobile;
  return null;
}

function extractMessage(payload) {
  if (payload?.message) return payload.message;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.text) return payload.text;
  return null;
}

function extractName(payload) {
  if (payload?.name) return payload.name;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
