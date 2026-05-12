const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, canSendMessage } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, needsEscalation, isOptOut, isHinglish, PROGRAM_NAMES, cors } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').upsert(
        { phone, opted_out: true, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();

      await db.from('escalations').insert({
        phone,
        client_id: client?.id || null,
        reason: 'keyword_trigger',
        message_body: message,
      });

      await sendTemplate(phone, 'escalation_ack', [
        'Maddy will personally review your message and get back to you soon.'
      ]);

      await notifyMaddy(phone, message);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      return await handleLeadReply(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const allowed = await canSendMessage(phone);
  if (!allowed) return res.status(200).json({ action: 'rate_limited' });

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const intent = classifyIntent(message);
  if (intent) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: intent,
    }).eq('phone', phone);

    await sendProgramLink(phone, intent, market);
  }

  return res.status(200).json({ action: 'new_lead', market });
}

async function handleLeadReply(db, lead, message, res) {
  const intent = classifyIntent(message);

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    ...(intent && { program_interest: intent, status: 'qualified' }),
  }).eq('id', lead.id);

  if (intent) {
    const allowed = await canSendMessage(lead.phone);
    if (allowed) {
      await sendProgramLink(lead.phone, intent, lead.market);
    }
  }

  return res.status(200).json({ action: 'lead_reply', intent });
}

async function sendProgramLink(phone, program, market) {
  const hinglish = isHinglish(market);
  const programName = PROGRAM_NAMES[program] || program;

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?phone=${encodeURIComponent(phone)}`;

  if (hinglish) {
    await sendTemplate(phone, 'program_link_hi', [
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  } else {
    await sendTemplate(phone, 'program_link_en', [
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }
}

async function notifyMaddy(phone, message) {
  const MADDY_PHONE = '+917082478374';
  const masked = phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
  await sendText(MADDY_PHONE, `ESCALATION from ${masked}: "${message.slice(0, 200)}"`);
}
