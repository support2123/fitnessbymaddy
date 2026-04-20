const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { matchProgram, getProgramName, getProgramPrice } = require('../lib/qualify');
const { isOptOut, escalateIfNeeded } = require('../lib/escalation');
const { logMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    console.log(`WA in: ${maskPhone(phone)} — ${message.slice(0, 50)}`);

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalated = await escalateIfNeeded(phone, message, 'Incoming WhatsApp');
    if (escalated) {
      return res.status(200).json({ action: 'escalated' });
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
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const hinglish = isHinglish(market);

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
      "Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
      "What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
    ]);
  }

  return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
}

async function handleLeadReply(db, lead, message, res) {
  const program = matchProgram(message);
  const hinglish = isHinglish(lead.market);

  if (!program) {
    if (hinglish) {
      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        "Agar confused ho toh $20 mein ek trial session try karo — link: https://fitnessbymaddy.com/intake?lead=" + lead.id
      ]);
    } else {
      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
        "Not sure yet? Try a $20 trial session — link: https://fitnessbymaddy.com/intake?lead=" + lead.id
      ]);
    }
    return res.status(200).json({ action: 'nudged_trial' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const price = getProgramPrice(program);
  const programName = getProgramName(program);
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  if (hinglish) {
    await sendTemplate(lead.phone, 'program_qualified', [
      lead.name || 'there',
      `${programName} ($${price}) — yeh perfect hai tere goal ke liye!`,
      intakeUrl
    ]);
  } else {
    await sendTemplate(lead.phone, 'program_qualified', [
      lead.name || 'there',
      `${programName} ($${price}) — this is perfect for your goals!`,
      intakeUrl
    ]);
  }

  return res.status(200).json({ action: 'qualified', program });
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
