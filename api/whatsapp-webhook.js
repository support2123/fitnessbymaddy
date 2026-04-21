const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');
const { json, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const text = payload.text || payload.body || payload.message || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return json(res, { error: 'No phone number' }, 400);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return json(res, { action: 'opted_out' });
    }

    const escalationReason = needsEscalation(text);
    if (escalationReason) {
      await createEscalation('message', null, phone, escalationReason);
    }

    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existing) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existing.status === 'dropped') {
      return json(res, { action: 'ignored_dropped' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (existing.status === 'new') {
      return await handleQualification(db, existing, text, res);
    }

    return json(res, { action: 'noted', lead_status: existing.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    })
    .select()
    .single();

  const hinglish = isHinglish(market);
  await sendWhatsApp(phone, 'welcome_v1', [
    name || (hinglish ? 'there' : 'there'),
  ]);

  return json(res, { action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const match = qualifyLead(text);

  if (!match) {
    const hinglish = isHinglish(lead.market);
    if (hinglish) {
      await sendWhatsApp(lead.phone, 'clarify_goal_hi', [lead.name || 'there']);
    } else {
      await sendWhatsApp(lead.phone, 'clarify_goal_en', [lead.name || 'there']);
    }
    return json(res, { action: 'asked_clarification' });
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const siteUrl = process.env.SITE_URL || 'https://fitnessbymaddy.com';

  await sendWhatsApp(lead.phone, 'program_offer', [
    lead.name || 'there',
    match.label,
    `$${match.price}`,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`,
    `${siteUrl}/intake?lead=${lead.id}`,
  ]);

  return json(res, { action: 'qualified', program: match.program });
}
