const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket, routeProgram, needsEscalation, isOptOut, jsonResponse, PROGRAM_META } = require('./_lib/helpers');
const { notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.senderPhone || body.from || body.waId;
    const text = body.text || body.message || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Keyword trigger in message', { phone, message: text });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadReply(db, existingLead, text, res);
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      status: 'new',
    })
    .select()
    .single();

  const greeting =
    market === 'IN'
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?";

  await sendTemplate(phone, 'welcome_v1', [greeting]);

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleLeadReply(db, lead, text, res) {
  const program = routeProgram(text);

  if (!program) {
    const canSend = await checkRateLimit(lead.phone);
    if (canSend) {
      const msg =
        lead.market === 'IN'
          ? 'Koi specific goal batao — fat loss, PCOS, strength, 40+ fitness, ya pehle trial try karna hai?'
          : 'Could you share your specific goal — fat loss, PCOS, strength, 40+ fitness, or try a trial first?';
      await sendTemplate(lead.phone, 'clarify_goal', [msg]);
    }
    return res.status(200).json({ action: 'clarification_sent' });
  }

  const meta = PROGRAM_META[program];

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msg =
    lead.market === 'IN'
      ? `Great choice! ${meta.name} — $${meta.price} mein ${meta.weeks} weeks ka complete program.\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
      : `Great choice! ${meta.name} — $${meta.price} for ${meta.weeks} weeks.\n\nCheckout: ${checkoutUrl}\n\nPlease fill the intake form: ${intakeUrl}`;

  await sendTemplate(lead.phone, 'program_offer', [msg]);

  return res.status(200).json({ action: 'qualified', program });
}
