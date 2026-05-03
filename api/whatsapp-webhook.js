const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendFreeform, logMessage, notifyMaddy } = require('./lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  matchProgram, programLabel, programPrice, maskPhone,
  parseBody, corsHeaders, json
} = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  try {
    const body = await parseBody(req);
    const phone = body.mobile || body.phone || body.from || body.waId;
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || null;

    if (!phone) return json(res, { error: 'missing phone' }, 400);

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      return await handleOptOut(phone, res);
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
    }

    const sb = getSupabase();
    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return json(res, { ok: true, action: 'ignored_dropped' });
    }

    const { data: existingClient } = await sb
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return await handleClientMessage(phone, text, existingClient, res);
    }

    if (!existingLead) {
      return await handleNewLead(phone, text, senderName, res);
    }

    return await handleExistingLead(phone, text, existingLead, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};

async function handleOptOut(phone, res) {
  const sb = getSupabase();
  await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  return json(res, { ok: true, action: 'opted_out' });
}

async function handleNewLead(phone, text, name, res) {
  const sb = getSupabase();
  const market = detectMarket(phone);

  await sb.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
      'fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
      'fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'
    ]);
  }

  return json(res, { ok: true, action: 'new_lead_welcomed' });
}

async function handleExistingLead(phone, text, lead, res) {
  const sb = getSupabase();
  const market = lead.market || detectMarket(phone);
  const program = matchProgram(text);

  await sb.from('leads').update({
    last_msg_at: new Date().toISOString(),
    ...(program && { program_interest: program, status: 'qualified' })
  }).eq('id', lead.id);

  if (program) {
    const price = programPrice(program);
    const label = programLabel(program);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

    const msg = isHinglish(market)
      ? `${label} — perfect choice! Price: $${price}\n\nCheckout: ${checkoutUrl}\n\nPehle ye form fill karo: ${intakeUrl}`
      : `${label} — great choice! Price: $${price}\n\nCheckout: ${checkoutUrl}\n\nPlease fill this intake form first: ${intakeUrl}`;

    await sendFreeform(phone, msg);
    return json(res, { ok: true, action: 'qualified', program });
  }

  return json(res, { ok: true, action: 'updated_lead' });
}

async function handleClientMessage(phone, text, client, res) {
  if (needsEscalation(text)) {
    await notifyMaddy(
      'Active client needs attention',
      `Client ID: ${client.id}\nPhone: ${maskPhone(phone)}\nMessage: ${text}`
    );
  }
  return json(res, { ok: true, action: 'client_msg_logged' });
}
