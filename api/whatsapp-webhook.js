const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, logMessage, canSendMessage, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket, needsEscalation, isOptOut, classifyIntent, cors, maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await notifyMaddy(`Escalation keyword: "${escalationKeyword}"`, phone, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    return await handleReturningLead(db, existingLead, text, res);

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text ? text.substring(0, 1000) : null,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  if (isHinglishMarket(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  const intent = classifyIntent(text);
  if (intent) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: intent.program
    }).eq('id', lead.id);

    await sendProgramLink(phone, intent, market);
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleReturningLead(db, lead, text, res) {
  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const intent = classifyIntent(text);
  if (!intent) {
    return res.status(200).json({ action: 'no_intent_detected' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: intent.program
  }).eq('id', lead.id);

  const canSend = await canSendMessage(lead.phone);
  if (!canSend) {
    return res.status(200).json({ action: 'rate_limited' });
  }

  await sendProgramLink(lead.phone, intent, lead.market);

  return res.status(200).json({ action: 'qualified', program: intent.program });
}

async function sendProgramLink(phone, intent, market) {
  const checkoutBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const intakeBase = 'https://fitnessbymaddy.com/intake';
  const hinglish = isHinglishMarket(market);

  const messages = {
    '6wk_gym': hinglish
      ? `6-Week Burn & Build — perfect choice! 🔥\n\nCheckout: ${checkoutBase}/6wk-gym\nIntake form: ${intakeBase}\n\nPayment ke baad turant access milega.`
      : `6-Week Burn & Build — great choice! 🔥\n\nCheckout: ${checkoutBase}/6wk-gym\nIntake form: ${intakeBase}\n\nYou'll get instant access after payment.`,
    '6wk_home': hinglish
      ? `6-Week Home Shred — no gym needed! 💪\n\nCheckout: ${checkoutBase}/6wk-home\nIntake form: ${intakeBase}\n\nPayment ke baad turant access milega.`
      : `6-Week Home Shred — no gym needed! 💪\n\nCheckout: ${checkoutBase}/6wk-home\nIntake form: ${intakeBase}\n\nYou'll get instant access after payment.`,
    'pcos': hinglish
      ? `PCOS Warrior Program — specially designed for hormonal health 🌸\n\nCheckout: ${checkoutBase}/pcos\nIntake form: ${intakeBase}`
      : `PCOS Warrior Program — designed for hormonal health 🌸\n\nCheckout: ${checkoutBase}/pcos\nIntake form: ${intakeBase}`,
    '40plus': hinglish
      ? `40+ Strong Program — age sirf number hai 💪\n\nCheckout: ${checkoutBase}/40plus\nIntake form: ${intakeBase}`
      : `40+ Strong Program — age is just a number 💪\n\nCheckout: ${checkoutBase}/40plus\nIntake form: ${intakeBase}`,
    '12wk': hinglish
      ? `12-Week Custom Training — Maddy ka flagship program ⭐\n\nCheckout: ${checkoutBase}/12wk\nIntake form: ${intakeBase}\n\nFully personalised plan milega!`
      : `12-Week Custom Training — Maddy's flagship program ⭐\n\nCheckout: ${checkoutBase}/12wk\nIntake form: ${intakeBase}\n\nYou'll get a fully personalised plan!`,
    'zoom_trial': hinglish
      ? `$20 Zoom Trial — pehle try karo, phir decide karo 🎯\n\nCheckout: ${checkoutBase}/zoom-trial\nIntake form: ${intakeBase}`
      : `$20 Zoom Trial — try before you commit 🎯\n\nCheckout: ${checkoutBase}/zoom-trial\nIntake form: ${intakeBase}`,
    'zoom_pack': hinglish
      ? `Zoom Pack — full coaching experience 🎯\n\nCheckout: ${checkoutBase}/zoom-pack\nIntake form: ${intakeBase}`
      : `Zoom Pack — the full coaching experience 🎯\n\nCheckout: ${checkoutBase}/zoom-pack\nIntake form: ${intakeBase}`
  };

  const msg = messages[intent.program] || messages['6wk_gym'];
  await sendText(phone, msg);
}
