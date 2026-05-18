const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, checkOptOut, notifyMaddy } = require('../lib/escalation');
const { routeToProgram, PROGRAMS } = require('../lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming WA from ${maskPhone(phone)}: ${message.slice(0, 50)}`);

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.needed) {
      await notifyMaddy(phone, escalation.reason, message);
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, senderName, message);
      return res.status(200).json({ action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      await handleLeadReply(db, existingLead, message);
      return res.status(200).json({ action: 'lead_qualified' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

async function handleNewLead(db, phone, name, firstMessage) {
  const market = detectMarket(phone);
  const programHint = routeToProgram(firstMessage);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: firstMessage,
    last_msg_at: new Date().toISOString(),
    program_interest: programHint,
    market,
    created_at: new Date().toISOString()
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  if (programHint) {
    await handleLeadReplyDirect(db, phone, programHint, market);
  }
}

async function handleLeadReply(db, lead, message) {
  const programSlug = routeToProgram(message);

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: programSlug || lead.program_interest
  }).eq('id', lead.id);

  if (programSlug) {
    await handleLeadReplyDirect(db, lead.phone, programSlug, lead.market);
    await db.from('leads').update({ status: 'qualified' }).eq('id', lead.id);
  }
}

async function handleLeadReplyDirect(db, phone, programSlug, market) {
  const program = PROGRAMS[programSlug];
  if (!program) return;

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programSlug}`;
  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendTemplate(phone, 'program_offer_hi', [
      program.name,
      `$${program.price}`,
      checkoutUrl
    ]);
  } else {
    await sendTemplate(phone, 'program_offer_en', [
      program.name,
      `$${program.price}`,
      checkoutUrl
    ]);
  }
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
  console.log(`Opted out: ${maskPhone(phone)}`);
}
