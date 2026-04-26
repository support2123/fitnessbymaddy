const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, detectMarket, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy, isOptOut } = require('./_lib/escalation');
const { matchProgram, getProgramName } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const text = payload.message || payload.text || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)} | Msg: ${text.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead) {
      await db
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'ignored_dropped' });
      }

      if (existingLead.status === 'converted') {
        return res.status(200).json({ action: 'already_converted' });
      }

      const program = matchProgram(text);
      if (program) {
        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';
        const programName = getProgramName(program);

        const msg = isHinglish
          ? `Great choice! ${programName} aapke liye perfect hai. Yahan se checkout karein aur intake form bhi fill karein:`
          : `Great choice! ${programName} is perfect for you. Complete your checkout and fill in the intake form:`;

        await sendTemplate(phone, 'program_checkout', {
          name: senderName || 'there',
          templateParams: [
            programName,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
            `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          ]
        });

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);

    const { data: newLead } = await db
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.slice(0, 500),
        market
      })
      .select()
      .single();

    const isHinglish = market === 'IN';

    await sendTemplate(phone, 'welcome_v1', {
      name: senderName || 'there',
      templateParams: isHinglish
        ? ['Maddy ki team', 'fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Maddy\'s team', 'fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?']
    });

    const program = matchProgram(text);
    if (program) {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', newLead.id);
    }

    return res.status(200).json({ action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
