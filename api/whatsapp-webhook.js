const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { canSendToLead, sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected', phone, text.slice(0, 100));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead_greeted', market });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    const match = qualifyLead(text);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const canSend = await canSendToLead(phone);
      if (canSend) {
        const hinglish = isHinglish(existingLead.market);
        if (hinglish) {
          await sendTemplate(phone, 'program_match', [
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }
      }

      return res.status(200).json({ action: 'lead_qualified', program: match.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
