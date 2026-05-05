const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const { shouldEscalate, shouldOptOut, notifyMaddy, detectProgram, PROGRAM_NAMES } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const message = body.text || body.message || body.body || '';
    const name = body.senderName || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (shouldOptOut(message)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (shouldEscalate(message)) {
      await notifyMaddy('Escalation keyword detected', `${phone}: ${message.slice(0, 100)}`);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeValues = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?'];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeValues,
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('phone', phone);

      const market = existingLead.market || 'IN';
      const programName = PROGRAM_NAMES[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgBody = market === 'IN'
        ? [`Great choice! ${programName} aapke liye perfect hai. Checkout karo: ${checkoutUrl} Aur intake form bhi fill karo: ${intakeUrl}`]
        : [`Great choice! ${programName} is perfect for you. Checkout here: ${checkoutUrl} Also fill your intake form: ${intakeUrl}`];

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        bodyValues: msgBody,
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
