const { getSupabase, TABLES } = require('./_utils/supabase');
const { sendTemplate } = require('./_utils/whatsapp');
const { detectMarket, isHinglish, classifyIntent, programLabel, checkoutUrl, jsonResponse, parseBody } = require('./_utils/helpers');
const { notifyMaddy, checkEscalationTriggers } = require('./_utils/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', webhook: 'whatsapp' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone || body.from || body.senderPhone || '');
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    await db.from(TABLES.MESSAGES).insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (/\b(stop|unsubscribe|opt.?out|hatao|band karo)\b/i.test(text)) {
      await db.from(TABLES.LEADS).update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalationTriggers(text);
    if (escalation) {
      await notifyMaddy(escalation, `Phone: ${phone}\nMessage: ${text.slice(0, 200)}`);
    }

    const { data: existingLead } = await db
      .from(TABLES.LEADS)
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      return await handleNewLead(db, phone, name, text, res);
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (lead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    return await handleReturningLead(db, lead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await db.from(TABLES.LEADS).insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text.slice(0, 500),
    last_msg_at: new Date().toISOString(),
    program_interest: null,
    market,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) {
    console.error('Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }

  const intent = classifyIntent(text);

  if (intent && intent !== 'OPTOUT' && intent !== 'ESCALATE') {
    await db.from(TABLES.LEADS).update({
      program_interest: intent,
      status: 'qualified',
    }).eq('id', lead.id);

    const label = programLabel(intent);
    const url = checkoutUrl(intent);
    const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

    if (isHinglish(market)) {
      await sendTemplate(phone, 'program_match_hi', [name || 'there', label, url, intakeUrl]);
    } else {
      await sendTemplate(phone, 'program_match_en', [name || 'there', label, url, intakeUrl]);
    }

    return res.status(200).json({ action: 'qualified', program: intent });
  }

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1_hi', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  return res.status(200).json({ action: 'new_lead_welcomed', leadId: lead.id });
}

async function handleReturningLead(db, lead, text, res) {
  await db.from(TABLES.LEADS).update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const intent = classifyIntent(text);

  if (!intent || intent === 'ESCALATE') {
    return res.status(200).json({ action: 'no_match', leadId: lead.id });
  }

  await db.from(TABLES.LEADS).update({
    program_interest: intent,
    status: 'qualified',
  }).eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const label = programLabel(intent);
  const url = checkoutUrl(intent);
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (isHinglish(market)) {
    await sendTemplate(lead.phone, 'program_match_hi', [lead.name || 'there', label, url, intakeUrl]);
  } else {
    await sendTemplate(lead.phone, 'program_match_en', [lead.name || 'there', label, url, intakeUrl]);
  }

  return res.status(200).json({ action: 'qualified', program: intent, leadId: lead.id });
}

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}
