const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logInbound } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile || '';
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logInbound(phone, text);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected in lead message', {
        phone, name: senderName, message: text
      });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, text, senderName);
      return res.status(200).json({ action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      await handleQualification(db, existingLead, text);
      return res.status(200).json({ action: 'qualified' });
    }

    return res.status(200).json({ action: 'existing_lead' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, name) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  const hinglish = isHinglish(market);
  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ]);
  }
}

async function handleQualification(db, lead, text) {
  const match = qualifyLead(text);
  if (!match) return;

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(match.program);
  const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

  const hinglish = isHinglish(lead.market);
  if (hinglish) {
    await sendTemplate(lead.phone, 'program_link_hi', [
      lead.name || 'there',
      match.label,
      checkoutUrl,
      intakeUrl
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_link_en', [
      lead.name || 'there',
      match.label,
      checkoutUrl,
      intakeUrl
    ]);
  }
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
}
