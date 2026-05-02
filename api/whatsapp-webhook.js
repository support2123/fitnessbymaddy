const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, getEscalationReason } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone in payload' });

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const reason = getEscalationReason(text);
      await notifyMaddy(
        'Lead needs human attention',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}\nKeywords: ${reason}`
      );
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    return await handleExistingLead(db, existingLead, text, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, name, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const welcomeMsg = hinglish
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendTemplate(phone, 'welcome_v1', [name || 'there']);

  const qualification = qualifyLead(text);
  if (qualification) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    const qualMsg = hinglish
      ? `Perfect! ${qualification.name} ($${qualification.price}) aapke liye best rahega. 💪\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhi fill karo: ${intakeUrl}`
      : `Perfect! I'd recommend our ${qualification.name} ($${qualification.price}) for you. 💪\n\nCheckout: ${checkoutUrl}\n\nPlease also fill this quick form: ${intakeUrl}`;

    await sendText(phone, qualMsg);

    return res.status(200).json({ action: 'new_lead_qualified', program: qualification.program });
  }

  return res.status(200).json({ action: 'new_lead_welcomed', leadId: lead.id });
}

async function handleExistingLead(db, lead, text, res) {
  const hinglish = isHinglish(lead.market);

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

  const qualification = qualifyLead(text);
  if (qualification) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    const qualMsg = hinglish
      ? `${qualification.name} ($${qualification.price}) aapke liye perfect hai! 🔥\n\nCheckout: ${checkoutUrl}\n\nYe form bhi fill karo: ${intakeUrl}`
      : `${qualification.name} ($${qualification.price}) would be perfect for you! 🔥\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form too: ${intakeUrl}`;

    await sendText(lead.phone, qualMsg);

    return res.status(200).json({ action: 'lead_qualified', program: qualification.program });
  }

  return res.status(200).json({ action: 'lead_reply_logged' });
}
