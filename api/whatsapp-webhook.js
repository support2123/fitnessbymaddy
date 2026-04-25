const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, canSendTo, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, corsHeaders } = require('./_lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { message, phone, name } = parsePayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message || '',
      status: 'received',
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(db, phone, message, 'Escalation keyword detected');
      return res.json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, res, phone, name, message);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return await handleReply(db, res, existingLead, message);
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};

  if (body.text && body.senderPhoneNumber) {
    return {
      message: body.text,
      phone: body.senderPhoneNumber,
      name: body.senderName || null,
    };
  }

  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      message: msg?.text?.body || '',
      phone: msg?.from || '',
      name: contact?.profile?.name || null,
    };
  }

  return {
    message: body.message || body.text || body.body || '',
    phone: body.phone || body.from || '',
    name: body.name || null,
  };
}

async function handleNewLead(db, res, phone, name, message) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message || '',
    last_msg_at: new Date().toISOString(),
    market,
  });

  const isHindi = market === 'IN';
  const welcomeValues = isHindi
    ? [name || 'there']
    : [name || 'there'];

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    bodyValues: welcomeValues,
  });

  if (message) {
    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('phone', phone);

      await sendCheckoutLink(phone, program, market);
    }
  }

  return res.json({ action: 'new_lead_created', market });
}

async function handleReply(db, res, lead, message) {
  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', lead.id);

      await sendCheckoutLink(lead.phone, program, lead.market);
      return res.json({ action: 'qualified', program });
    }
  }

  return res.json({ action: 'reply_logged' });
}

async function sendCheckoutLink(phone, program, market) {
  const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const formBase = 'https://www.fitnessbymaddy.com/intake';

  const allowed = await canSendTo(phone);
  if (!allowed) return;

  await sendWhatsApp({
    phone,
    templateName: 'checkout_link',
    bodyValues: [
      checkoutBase,
      `${formBase}?program=${program}`,
    ],
  });
}

async function notifyMaddy(db, phone, message, reason) {
  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [
      maskPhone(phone),
      reason,
      (message || '').slice(0, 200),
    ],
  });
}
