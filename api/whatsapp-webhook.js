const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.pushName || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, message);

    if (isOptOut(message)) {
      return await handleOptOut(phone, res);
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Sensitive keyword detected', { phone, name, message });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      return await handleReturningLead(db, existingLead, message, phone, res);
    }

    return await handleNewLead(db, phone, name, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleOptOut(phone, res) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
  return res.status(200).json({ action: 'opted_out' });
}

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  const hinglish = isHinglish(market);
  await sendWhatsApp(phone, 'welcome_v1', [
    name || (hinglish ? 'there' : 'there'),
  ]);

  const match = qualifyLead(message);
  if (match) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: match.program })
      .eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (hinglish) {
      await sendWhatsApp(phone, 'program_match_hi', [
        name || 'there',
        match.name,
        `$${match.price}`,
        checkoutUrl,
        intakeUrl,
      ]);
    } else {
      await sendWhatsApp(phone, 'program_match_en', [
        name || 'there',
        match.name,
        `$${match.price}`,
        checkoutUrl,
        intakeUrl,
      ]);
    }
  }

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleReturningLead(db, lead, message, phone, res) {
  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  if (lead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (lead.status === 'new') {
    const match = qualifyLead(message);
    if (match) {
      const market = detectMarket(phone);
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: match.program })
        .eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      await sendWhatsApp(phone, isHinglish(market) ? 'program_match_hi' : 'program_match_en', [
        lead.name || 'there',
        match.name,
        `$${match.price}`,
        checkoutUrl,
        intakeUrl,
      ]);
    }
  }

  return res.status(200).json({ action: 'returning_lead', leadId: lead.id });
}
