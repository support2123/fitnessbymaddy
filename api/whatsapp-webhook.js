const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.sender);
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.sender_name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', message);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', phone, message.slice(0, 200));
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return await handleReturningLead(db, existingLead, message, res);
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const welcomeMsg = hinglish
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Welcome to Fitness by Maddy. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeMsg);

  const qualification = qualifyLead(message);
  if (qualification) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program,
    }).eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(qualification.program);
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

    const qualifyMsg = hinglish
      ? [`${qualification.label}`, checkoutUrl, intakeUrl]
      : [`${qualification.label}`, checkoutUrl, intakeUrl];

    await sendWhatsApp(phone, 'program_recommend', qualifyMsg);
  }

  return res.json({ action: 'new_lead', lead_id: lead.id, qualified: !!qualification });
}

async function handleReturningLead(db, lead, message, res) {
  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const qualification = qualifyLead(message);
    if (qualification) {
      const market = detectMarket(lead.phone);
      const hinglish = isHinglish(market);

      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program,
      }).eq('id', lead.id);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendWhatsApp(lead.phone, 'program_recommend', [
        qualification.label,
        checkoutUrl,
        intakeUrl,
      ]);

      return res.json({ action: 'qualified', program: qualification.program });
    }
  }

  return res.json({ action: 'message_logged' });
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
}

function isOptOut(msg) {
  const lower = (msg || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'cancel';
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
