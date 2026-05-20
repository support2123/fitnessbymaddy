const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { needsEscalation, createEscalation, isOptOut } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.mobile || body.phone || body.from || '');
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await createEscalation(phone, esc.reason, message);
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

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, message, res);
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market,
    })
    .select()
    .single();

  if (isHinglishMarket(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const match = qualifyLead(message);
  if (match) {
    await supabase
      .from('leads')
      .update({
        status: 'qualified',
        program_interest: match.program,
      })
      .eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${match.checkoutSlug}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (isHinglishMarket(market)) {
      await sendTextMessage(phone,
        `Great choice! 🔥 ${match.label} program — $${match.price}\n\n` +
        `Checkout: ${checkoutUrl}\n\n` +
        `Pehle ye form bhi fill kardo: ${intakeUrl}`
      );
    } else {
      await sendTextMessage(phone,
        `Great choice! 🔥 ${match.label} program — $${match.price}\n\n` +
        `Checkout: ${checkoutUrl}\n\n` +
        `Also, please fill this form: ${intakeUrl}`
      );
    }

    return res.status(200).json({ action: 'qualified', program: match.program });
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification(lead, message, res) {
  const match = qualifyLead(message);
  const market = lead.market || detectMarket(lead.phone);

  if (!match) {
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (isHinglishMarket(market)) {
      await sendTextMessage(lead.phone,
        'Koi tension nahi! Batao kya goal hai — fat loss, PCOS, strength, ya 40+ fitness? ' +
        'Ya pehle $20 trial try karna hai?'
      );
    } else {
      await sendTextMessage(lead.phone,
        'No worries! What\'s your main goal — fat loss, PCOS, strength, or 40+ fitness? ' +
        'Or would you like to try a $20 trial session first?'
      );
    }

    return res.status(200).json({ action: 'asked_again' });
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/${match.checkoutSlug}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (isHinglishMarket(market)) {
    await sendTextMessage(lead.phone,
      `Perfect! ${match.label} — $${match.price} 💪\n\n` +
      `Checkout yahan se karo: ${checkoutUrl}\n\n` +
      `Aur ye intake form fill kardo: ${intakeUrl}`
    );
  } else {
    await sendTextMessage(lead.phone,
      `Perfect! ${match.label} — $${match.price} 💪\n\n` +
      `Checkout here: ${checkoutUrl}\n\n` +
      `And please fill this intake form: ${intakeUrl}`
    );
  }

  return res.status(200).json({ action: 'qualified', program: match.program });
}

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
