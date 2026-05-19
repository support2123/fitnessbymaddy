const { getClient } = require('../lib/supabase');
const { sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { logMessage, notifyMaddy } = require('../lib/escalation');
const {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  maskPhone, PROGRAM_NAMES,
} = require('../lib/utils');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.phone;
    const message = payload.message || payload.text?.body || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const cleaned = phone.replace(/\D/g, '');

    await logMessage(db, cleaned, 'in', message, null);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', cleaned);
      await db.from('clients').update({ status: 'paused' }).eq('phone', cleaned);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(
        'Escalation keyword detected',
        `Phone: ${maskPhone(cleaned)} — Message: "${message.slice(0, 200)}"`
      );
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', cleaned)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleaned)
      .single();

    if (existingLead) {
      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const market = detectMarket(cleaned);
        const lang = market === 'IN' ? 'hi' : 'en';
        const programName = PROGRAM_NAMES[program] || program;

        const qualifyMsg = lang === 'hi'
          ? `Great choice! 🔥 ${programName} aapke liye perfect hai. Yeh raha aapka checkout link:\n\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nSaath mein yeh intake form bhi fill kar do:\nhttps://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          : `Great choice! 🔥 The ${programName} is perfect for you. Here's your checkout link:\n\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nAlso fill out this quick intake form:\nhttps://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendTextMessage(cleaned, qualifyMsg);
        await logMessage(db, cleaned, 'out', qualifyMsg, null);

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const market = detectMarket(cleaned);
    const { data: newLead } = await db.from('leads').insert({
      phone: cleaned,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const welcomeMsg = market === 'IN'
      ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

    await sendTextMessage(cleaned, welcomeMsg);
    await logMessage(db, cleaned, 'out', welcomeMsg, 'welcome_v1');

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', newLead.id);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
