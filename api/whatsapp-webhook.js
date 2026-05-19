const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

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
    const message = extractMessage(body);
    if (!message) return res.status(200).json({ status: 'no_message' });

    const { phone, text, name } = message;
    const db = getSupabase();

    await logMessage({ phone, direction: 'in', body: text });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: client } = await db.from('clients').select('name').eq('phone', phone).single();
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        message: text,
        clientName: client?.name || name || 'Unknown',
      });
    }

    const { data: existingClient } = await db.from('clients').select('id, status').eq('phone', phone).eq('status', 'active').single();
    if (existingClient) {
      return res.status(200).json({ status: 'active_client', note: 'Handled by support flow' });
    }

    const { data: existingLead } = await db.from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'dropped_lead' });
    }

    return await handleLeadReply(db, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const hinglish = isHinglish(market);
  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: hinglish
      ? [name || 'there']
      : [name || 'there'],
  });

  return res.status(200).json({ status: 'new_lead_created' });
}

async function handleLeadReply(db, lead, text, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const match = qualifyLead(text);
  if (!match) {
    return res.status(200).json({ status: 'no_program_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
  }).eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(match.program);
  const hinglish = isHinglish(lead.market);

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_recommendation',
    bodyValues: hinglish
      ? [lead.name || 'there', match.label, `$${match.price}`, checkoutUrl, `https://fitnessbymaddy.com/intake?lead=${lead.id}`]
      : [lead.name || 'there', match.label, `$${match.price}`, checkoutUrl, `https://fitnessbymaddy.com/intake?lead=${lead.id}`],
  });

  return res.status(200).json({ status: 'qualified', program: match.program });
}

function extractMessage(body) {
  if (body.entry) {
    const entry = body.entry[0];
    const changes = entry?.changes?.[0];
    const msg = changes?.value?.messages?.[0];
    if (!msg) return null;
    const contact = changes?.value?.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null,
    };
  }

  if (body.phone || body.mobile) {
    return {
      phone: body.phone || body.mobile,
      text: body.message || body.text || body.body || '',
      name: body.name || body.pushName || null,
    };
  }

  return null;
}
