const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/whatsapp');
const { detectMarket, classifyIntent, isOptOut, programLabel, cors, parseBody } = require('./_lib/utils');
const { needsEscalation, escalationReason, notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.phone || body.waId || body.from;
  const message = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || null;

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    status: 'received',
  });

  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    const reason = escalationReason(message);
    await notifyMaddy({ phone, reason, message, type: 'Lead message flagged' });
    return res.status(200).json({ action: 'escalated', reason });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const intent = classifyIntent(message);

    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      program_interest: intent,
      market,
    });

    if (market === 'IN') {
      await sendWhatsApp(phone, 'welcome_v1', [
        name || 'there',
      ]);
    } else {
      await sendWhatsApp(phone, 'welcome_v1_en', [
        name || 'there',
      ]);
    }

    scheduleNudge(phone, db);

    return res.status(200).json({ action: 'new_lead', market });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    name: name || existingLead.name,
  }).eq('id', existingLead.id);

  const intent = classifyIntent(message);
  if (intent && existingLead.status === 'new') {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: intent,
    }).eq('id', existingLead.id);

    const label = programLabel(intent);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    if (existingLead.market === 'IN') {
      await sendWhatsApp(phone, 'program_match', [
        name || 'there',
        label,
        checkoutUrl,
        intakeUrl,
      ]);
    } else {
      await sendWhatsApp(phone, 'program_match_en', [
        name || 'there',
        label,
        checkoutUrl,
        intakeUrl,
      ]);
    }

    return res.status(200).json({ action: 'qualified', program: intent });
  }

  return res.status(200).json({ action: 'message_logged' });
};

function scheduleNudge(phone, db) {
  setTimeout(async () => {
    try {
      const { data: lead } = await db
        .from('leads')
        .select('status')
        .eq('phone', phone)
        .single();
      if (lead && lead.status === 'new') {
        await sendWhatsApp(phone, 'nudge_trial', []);
      }
    } catch (e) {
      console.error(`Nudge failed for ${maskPhone(phone)}:`, e.message);
    }
  }, 2 * 60 * 60 * 1000);

  setTimeout(async () => {
    try {
      const { data: lead } = await db
        .from('leads')
        .select('status')
        .eq('phone', phone)
        .single();
      if (lead && lead.status === 'new') {
        await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      }
    } catch (e) {
      console.error(`Drop failed for ${maskPhone(phone)}:`, e.message);
    }
  }, 24 * 60 * 60 * 1000);
}
