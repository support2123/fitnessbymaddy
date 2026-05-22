const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy, checkOptOut } = require('../lib/escalation');
const { matchProgram } = require('../lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name, senderName } = parseWebhookBody(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    console.log(`Incoming from ${maskPhone(phone)}: ${message.substring(0, 50)}`);
    await logIncoming(phone, message);
    const db = getSupabase();

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out processed for ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}`
      );
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name || senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, message, res);
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookBody(body) {
  if (body.phone) return body;
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (msg) {
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || '',
        name: changes?.contacts?.[0]?.profile?.name || ''
      };
    }
  }
  return { phone: body.mobile || body.from, message: body.text || body.body || '', senderName: body.name };
}

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    market
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  } else {
    await sendTemplate(phone, 'welcome_v1_en', {
      name: name || 'there',
      templateParams: [name || 'there']
    });
  }

  const programMatch = matchProgram(message);
  if (programMatch) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: programMatch.program
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programMatch.program}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

    const msg = isHinglish(market)
      ? `Perfect! ${programMatch.label} (${programMatch.price}) tere liye best rahega.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
      : `Perfect! ${programMatch.label} (${programMatch.price}) would be ideal for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

    await sendTextMessage(phone, msg);
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleLeadReply(db, lead, message, res) {
  const market = lead.market || 'GLOBAL';

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const programMatch = matchProgram(message);
  if (programMatch) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: programMatch.program
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programMatch.program}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

    const msg = isHinglish(market)
      ? `${programMatch.label} (${programMatch.price}) — ye raha checkout link:\n${checkoutUrl}\n\nAur ye form bhar do:\n${intakeUrl}`
      : `${programMatch.label} (${programMatch.price}) — here's your checkout:\n${checkoutUrl}\n\nAnd please fill this form:\n${intakeUrl}`;

    await sendTextMessage(lead.phone, msg);
    return res.status(200).json({ action: 'qualified', program: programMatch.program });
  }

  return res.status(200).json({ action: 'reply_logged' });
}
