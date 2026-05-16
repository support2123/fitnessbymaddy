const { supabase } = require('./lib/supabase');
const { detectMarket, sendTemplate, sendFreeform, needsEscalation, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { matchProgram, isOptOut } = require('./lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile);
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(
        'Keyword trigger',
        `From: ${maskPhone(phone)}\nMessage: ${message.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification(phone, message, existingLead, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  });

  const isHinglish = market === 'IN';
  const templateName = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';

  await sendTemplate(phone, templateName, [name || 'there']);

  const programMatch = matchProgram(message);
  if (programMatch) {
    await handleQualificationDirect(phone, programMatch, market);
    return res.status(200).json({ action: 'new_lead_qualified', program: programMatch.program });
  }

  return res.status(200).json({ action: 'new_lead_welcomed' });
}

async function handleQualification(phone, message, lead, res) {
  const programMatch = matchProgram(message);

  if (!programMatch) {
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await handleQualificationDirect(phone, programMatch, lead.market);
  return res.status(200).json({ action: 'qualified', program: programMatch.program });
}

async function handleQualificationDirect(phone, programMatch, market) {
  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: programMatch.program
    })
    .eq('phone', phone);

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programMatch.checkout}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const isHinglish = market === 'IN';

  if (isHinglish) {
    await sendFreeform(phone,
      `Perfect! 🎯 Tumhare liye best rahega: *${programMatch.name}*\n\n` +
      `💰 Price: $${programMatch.price}\n\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `Checkout ke baad ye form bhar do:\n${intakeUrl}\n\n` +
      `Koi doubt? Yahan puch lo!`
    );
  } else {
    await sendFreeform(phone,
      `Perfect! 🎯 Based on your goal, I'd recommend: *${programMatch.name}*\n\n` +
      `💰 Price: $${programMatch.price}\n\n` +
      `👉 Checkout: ${checkoutUrl}\n\n` +
      `After payment, fill this intake form:\n${intakeUrl}\n\n` +
      `Any questions? Just ask!`
    );
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
