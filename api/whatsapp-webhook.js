const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, needsEscalation, isOptOut, matchProgram, maskPhone, getProgramName, jsonResponse } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderPhone;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Sensitive keyword detected in message',
        phone,
        details: `Message: "${text.substring(0, 100)}"`
      });
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
        market
      });

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_welcomed', phone: maskPhone(phone) });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = matchProgram(text);

      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('phone', phone);

        const programName = getProgramName(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! ${programName} aapke liye perfect rahega. Yahan se checkout karein: ${checkoutUrl}\n\nAur yeh intake form bhi fill kar dein taaki hum aapka plan bana sakein: ${intakeUrl}`
          : `Great choice! ${programName} sounds perfect for you. Checkout here: ${checkoutUrl}\n\nAlso fill out this intake form so we can build your plan: ${intakeUrl}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_qualify',
          body: qualifyMsg,
          params: [name || 'there', programName]
        });

        return res.status(200).json({ action: 'qualified', program, phone: maskPhone(phone) });
      }

      const { data: activeClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (activeClient) {
        return res.status(200).json({ action: 'active_client_msg', phone: maskPhone(phone) });
      }

      return res.status(200).json({ action: 'unmatched_reply', phone: maskPhone(phone) });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status, phone: maskPhone(phone) });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
