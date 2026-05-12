const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, isOptOutMessage, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

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

    if (!phone) {
      return res.status(200).json({ status: 'no_phone' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message || '',
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOutMessage(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Lead message flagged',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, message, res);
    }

    return res.status(200).json({ status: 'existing_lead', id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message || '',
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const match = qualifyLead(message);
  if (match) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: match.program,
    }).eq('id', lead.id);

    const lang = market === 'IN' ? 'hinglish' : 'english';
    await sendQualifiedReply(phone, match, lead.id, lang);
  } else {
    await sendWhatsApp(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there'],
    });
  }

  return res.status(200).json({ status: 'new_lead', id: lead.id });
}

async function handleLeadReply(db, lead, message, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const match = qualifyLead(message);
  if (match) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: match.program,
    }).eq('id', lead.id);

    const lang = lead.market === 'IN' ? 'hinglish' : 'english';
    await sendQualifiedReply(lead.phone, match, lead.id, lang);
  }

  return res.status(200).json({ status: 'reply_processed', id: lead.id });
}

async function sendQualifiedReply(phone, match, leadId, lang) {
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  await sendWhatsApp(phone, 'program_match', {
    templateParams: [match.label, match.price, checkoutUrl, intakeUrl],
  });
}

function extractPhone(payload) {
  if (payload?.phone) return payload.phone;
  if (payload?.mobile) return payload.mobile;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload?.waId) return '+' + payload.waId;
  return null;
}

function extractMessage(payload) {
  if (payload?.message) return payload.message;
  if (payload?.text) return payload.text;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  return '';
}

function extractName(payload) {
  if (payload?.name) return payload.name;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
