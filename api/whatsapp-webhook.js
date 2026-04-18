const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const {
  detectMarket, needsEscalation, isOptOut, detectProgram,
  PROGRAM_NAMES, jsonResponse,
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (needsEscalation(text)) {
      const maddyPhone = process.env.MADDY_PHONE;
      if (maddyPhone) {
        await sendWhatsApp(maddyPhone, 'escalation_alert', [
          phone.slice(-4),
          text.slice(0, 200),
        ]);
      }
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name,
    }).eq('phone', phone);

    const program = detectProgram(text);
    if (program && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('phone', phone);

      const programName = PROGRAM_NAMES[program] || program;
      const market = existingLead.market || 'IN';

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgParams = market === 'IN'
        ? [programName, checkoutUrl, intakeUrl]
        : [programName, checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_recommendation', msgParams);

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
