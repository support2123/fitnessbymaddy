const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone, sendEscalation } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, isHinglish, PROGRAM_NAMES } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name } = parsePayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await db.from('messages').insert({
      phone, direction: 'in', body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await sendEscalation(
        `Lead ${maskPhone(phone)} said: "${message.slice(0, 200)}". Review needed.`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, { phone, message, name }, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    return await handleReturningLead(db, existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, { phone, message, name }, res) {
  const market = detectMarket(phone);
  const program = detectProgram(message);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: program ? 'qualified' : 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    program_interest: program,
    market,
  }).select().single();

  if (program) {
    await sendProgramReply(phone, program, market, lead.id);
  } else {
    const greeting = isHinglish(market)
      ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

    await sendWhatsApp({ phone, templateName: 'welcome_v1', params: [greeting] });
  }

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleReturningLead(db, lead, message, res) {
  const program = detectProgram(message);

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    ...(program && { program_interest: program, status: 'qualified' }),
  }).eq('id', lead.id);

  if (program && lead.status === 'new') {
    await sendProgramReply(lead.phone, program, lead.market, lead.id);
    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
}

async function sendProgramReply(phone, program, market, leadId) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  const msg = isHinglish(market)
    ? `Great choice! 🔥 ${programName} — yeh program aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad, yeh form bhi fill kardo:\n${intakeUrl}`
    : `Great choice! 🔥 ${programName} is perfect for your goals.\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, please fill this intake form:\n${intakeUrl}`;

  await sendWhatsApp({ phone, body: msg });
}

function parsePayload(body) {
  if (body.senderPhoneNumber) {
    return {
      phone: body.senderPhoneNumber.replace(/\D/g, ''),
      message: body.message?.text || body.text || '',
      name: body.senderName || null,
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: change?.contacts?.[0]?.profile?.name || null,
    };
  }
  return {
    phone: body.phone || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || null,
  };
}
