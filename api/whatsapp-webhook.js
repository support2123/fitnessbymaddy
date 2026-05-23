const { getSupabase } = require('../lib/supabase');
const { maskPhone, detectMarket, canSendMessage, sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, notifyMaddy } = require('../lib/escalation');
const { matchProgram, getCheckoutUrl, getIntakeUrl } = require('../lib/routing');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Escalation trigger', `From ${maskPhone(phone)}: ${message.slice(0, 100)}`);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'updated' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.message_data) {
    return {
      phone: body.message_data.from || body.phone,
      message: body.message_data.text || body.message_data.body || '',
      name: body.message_data.pushName || body.name || null
    };
  }
  return {
    phone: body.phone || body.from || '',
    message: body.text || body.message || body.body || '',
    name: body.name || body.pushName || null
  };
}

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
    status: 'new'
  }).select().single();

  const match = matchProgram(message);
  if (match) {
    return await routeToProgram(db, lead, match, res);
  }

  await sendTemplate(phone, 'welcome_v1');

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const match = matchProgram(message);
  if (!match) {
    if (await canSendMessage(lead.phone)) {
      await sendTextMessage(
        lead.phone,
        lead.market === 'IN'
          ? 'Koi baat nahi! Bata do — fat loss, PCOS, 40+ fitness, ya ek trial session? Main sahi program suggest karungi 💪'
          : 'No worries! Tell me — fat loss, PCOS, 40+ fitness, or a trial session? I\'ll recommend the right program for you 💪'
      );
    }
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  return await routeToProgram(db, lead, match, res);
}

async function routeToProgram(db, lead, match, res) {
  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(match.checkoutPath);
  const intakeUrl = getIntakeUrl(lead.id);

  const msg = lead.market === 'IN'
    ? `${match.name} — bilkul sahi choice! 🔥\n\n💰 Price: $${match.price}\n🔗 Checkout: ${checkoutUrl}\n\n📝 Ek chota form bhi fill kar do taaki main tumhara plan personalise kar sakun:\n${intakeUrl}`
    : `${match.name} — great choice! 🔥\n\n💰 Price: $${match.price}\n🔗 Checkout: ${checkoutUrl}\n\n📝 Please also fill this quick form so I can personalise your plan:\n${intakeUrl}`;

  await sendTextMessage(lead.phone, msg);

  return res.status(200).json({ action: 'qualified', program: match.program });
}
