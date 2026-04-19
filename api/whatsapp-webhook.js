const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  detectProgram, maskPhone, PROGRAM_NAMES, jsonResponse,
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.sender || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`[OPT-OUT] ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Flagged message from lead', phone, `Message: "${text.slice(0, 200)}"`);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const greeting = isHinglish(market)
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        params: [name || 'there'],
      });

      console.log(`[NEW LEAD] ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'welcome_sent' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name,
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(text);

      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('phone', phone);

        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const msg = isHinglish(market)
          ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad ye form bhar do:\n${intakeUrl}`
          : `Great choice! ${programName} is perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, fill this intake form:\n${intakeUrl}`;

        await sendWhatsApp({ phone, body: msg });

        console.log(`[QUALIFIED] ${maskPhone(phone)} → ${program}`);
        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead' });
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
