const { getSupabase } = require('./lib/supabase');
const { logMessage, canSendMessage, sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const db = getSupabase();
    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existing.status === 'new') {
      return await handleQualification(db, existing, text, res);
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existing.id);

    return res.status(200).json({ action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.phone || ''), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const match = qualifyLead(text);
  if (match) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: match.program })
      .eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(match.program);
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    if (isHinglish(market)) {
      await sendText(phone,
        `Great choice! ${match.label} program aapke liye perfect hai.\n\n` +
        `Checkout: ${checkoutUrl}\n` +
        `Intake form bhi fill karo: ${intakeUrl}`
      );
    } else {
      await sendText(phone,
        `Great choice! The ${match.label} program is perfect for you.\n\n` +
        `Checkout: ${checkoutUrl}\n` +
        `Please also fill your intake form: ${intakeUrl}`
      );
    }
  }

  return res.status(200).json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const match = qualifyLead(text);
  if (!match) {
    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);
    return res.status(200).json({ action: 'no_match' });
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const checkoutUrl = getCheckoutUrl(match.program);
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (isHinglish(market)) {
    await sendText(lead.phone,
      `${match.label} — yeh program aapke liye bana hai!\n\n` +
      `Checkout karo: ${checkoutUrl}\n` +
      `Pehle intake form fill karo: ${intakeUrl}`
    );
  } else {
    await sendText(lead.phone,
      `${match.label} — this program is made for you!\n\n` +
      `Checkout: ${checkoutUrl}\n` +
      `First, fill your intake form: ${intakeUrl}`
    );
  }

  return res.status(200).json({ action: 'qualified', program: match.program });
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

function normalizePhone(payload) {
  return payload?.phone || payload?.from || payload?.sender?.phone || payload?.contact?.phone || null;
}

function extractText(payload) {
  return payload?.text || payload?.message?.text || payload?.body || payload?.message?.body || '';
}

function extractName(payload) {
  return payload?.name || payload?.sender?.name || payload?.contact?.name || null;
}
