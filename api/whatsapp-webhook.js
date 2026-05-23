const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { checkEscalation, createEscalation } = require('../lib/escalation');
const { detectProgram, isOptOut, PROGRAM_NAMES, PROGRAM_PRICES } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    if (isOptOut(messageBody)) {
      await db.from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(messageBody);
    if (escalationKeyword) {
      await createEscalation(phone, escalationKeyword, messageBody);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, phone, senderName, messageBody, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, messageBody, res);
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.json({ action: 'updated' });

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
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }

  return res.json({ action: 'new_lead_created', market });
}

async function handleQualification(db, lead, message, res) {
  const program = detectProgram(message);

  if (!program) {
    const hinglish = isHinglish(lead.market);
    if (hinglish) {
      await sendText(lead.phone,
        'Got it! Kya aap batayenge exactly kya goal hai? Fat loss, muscle gain, PCOS, ya 40+ fitness? Ya pehle ek trial session try karna hai?'
      );
    } else {
      await sendText(lead.phone,
        'Got it! Could you tell me your main goal? Fat loss, muscle gain, PCOS management, 40+ fitness, or would you like to try a trial session first?'
      );
    }
    return res.json({ action: 'asked_for_clarification' });
  }

  const programName = PROGRAM_NAMES[program];
  const price = PROGRAM_PRICES[program];

  await db.from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const hinglish = isHinglish(lead.market);

  if (hinglish) {
    await sendTemplate(lead.phone, 'program_offer', [
      lead.name || 'there',
      programName,
      `$${price}`,
      checkoutUrl,
      intakeUrl
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_offer_en', [
      lead.name || 'there',
      programName,
      `$${price}`,
      checkoutUrl,
      intakeUrl
    ]);
  }

  return res.json({ action: 'qualified', program });
}
