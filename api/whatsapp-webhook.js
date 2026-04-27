const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', phone, message.slice(0, 200));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const hinglish = isHinglish(market);
      const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendWhatsApp(phone, templateName, [name || 'there']);

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      const match = qualifyLead(message);
      if (match) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
          })
          .eq('phone', phone);

        const hinglish = isHinglish(market);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (hinglish) {
          await sendWhatsApp(phone, 'program_match_hi', [
            name || 'there',
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl,
          ]);
        } else {
          await sendWhatsApp(phone, 'program_match_en', [
            name || 'there',
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.status(200).json({ action: 'lead_qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
