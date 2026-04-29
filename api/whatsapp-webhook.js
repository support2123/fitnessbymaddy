const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket, checkEscalation, matchProgram, maskPhone, programDisplayName } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const message = extractMessage(body);
    if (!message) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const { phone, text, name } = message;
    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalationTrigger = checkEscalation(text);
    if (escalationTrigger) {
      await db.from('escalations').insert({
        phone,
        trigger_type: escalationTrigger,
        message_body: text
      });
      await notifyMaddy(`Escalation [${escalationTrigger}] from ${maskPhone(phone)}: "${text.slice(0, 100)}"`);
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, name, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ ok: true, action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal' });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const hinglish = isHinglishMarket(market);

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: hinglish
      ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here. What\'s your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?',
    params: [name || 'there']
  });

  const program = matchProgram(text);
  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', lead.id);

    await sendProgramInfo(phone, program, lead.id, hinglish);
  }

  return res.status(200).json({ ok: true, action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const program = matchProgram(text);
  if (!program) {
    return res.status(200).json({ ok: true, action: 'no_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const hinglish = isHinglishMarket(lead.market);
  await sendProgramInfo(lead.phone, program, lead.id, hinglish);

  return res.status(200).json({ ok: true, action: 'qualified', program });
}

async function sendProgramInfo(phone, program, leadId, hinglish) {
  const name = programDisplayName(program);
  const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;

  const msg = hinglish
    ? `${name} — ye program aapke liye perfect hai!\n\nCheckout: ${checkoutBase}/${program}\n\nPehle ye form fill karo: ${intakeUrl}\n\nKoi sawaal ho toh poochho!`
    : `${name} — this program is perfect for you!\n\nCheckout: ${checkoutBase}/${program}\n\nPlease fill this form first: ${intakeUrl}\n\nAny questions? Just ask!`;

  await sendWhatsApp({
    phone,
    templateName: 'program_info',
    body: msg,
    params: [name]
  });
}

function extractMessage(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (body?.phone && body?.message) {
    return {
      phone: body.phone.replace(/\D/g, ''),
      text: body.message,
      name: body.name || null
    };
  }

  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}
