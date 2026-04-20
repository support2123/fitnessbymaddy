const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, getEscalationReason } = require('../lib/escalation');
const { routeByKeywords, getCheckoutUrl, getIntakeUrl } = require('../lib/routing');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, name, message } = parsePayload(req.body);
    if (!phone || !message) {
      return res.status(200).json({ ok: true, skipped: 'no_message' });
    }

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy(
        'Escalation needed',
        `Phone: ${maskPhone(phone)} | Reason: ${reason} | Msg: ${message.slice(0, 100)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, skipped: 'dropped_lead' });
    }

    return await handleExistingLead(existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal' });
  }
};

function parsePayload(body) {
  if (body.senderMobile) {
    return {
      phone: normalizePhone(body.senderMobile),
      name: body.senderName || null,
      message: body.message || ''
    };
  }

  if (body.entry) {
    const entry = body.entry[0];
    const changes = entry?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];
    if (msg) {
      return {
        phone: normalizePhone(msg.from),
        name: contact?.profile?.name || null,
        message: msg.text?.body || msg.button?.text || ''
      };
    }
  }

  return { phone: null, name: null, message: null };
}

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await supabase.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: message, last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const route = routeByKeywords(message);
  if (route) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: route.program })
      .eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(route);
    const intakeUrl = getIntakeUrl(lead.id);

    if (hinglish) {
      await sendTemplate(phone, 'program_offer_hi', [
        name || 'there', route.label, `$${route.price}`, checkoutUrl, intakeUrl
      ]);
    } else {
      await sendTemplate(phone, 'program_offer_en', [
        name || 'there', route.label, `$${route.price}`, checkoutUrl, intakeUrl
      ]);
    }

    return res.status(200).json({ ok: true, action: 'qualified', program: route.program });
  }

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return res.status(200).json({ ok: true, action: 'new_lead_welcomed' });
}

async function handleExistingLead(lead, message, res) {
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const route = routeByKeywords(message);
  if (route && lead.status === 'new') {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: route.program })
      .eq('id', lead.id);

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);
    const checkoutUrl = getCheckoutUrl(route);
    const intakeUrl = getIntakeUrl(lead.id);

    const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';
    await sendTemplate(lead.phone, templateName, [
      lead.name || 'there', route.label, `$${route.price}`, checkoutUrl, intakeUrl
    ]);

    return res.status(200).json({ ok: true, action: 'qualified', program: route.program });
  }

  return res.status(200).json({ ok: true, action: 'noted' });
}
