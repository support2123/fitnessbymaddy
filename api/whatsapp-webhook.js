const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message: text });
      return res.status(200).json({ action: 'escalated' });
    }

    const optOutWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (optOutWords.some(w => text.toLowerCase().includes(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const match = qualifyLead(text);
      if (match) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: match.program })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const checkoutUrl = getCheckoutUrl(existingLead.id);
        const intakeUrl = getIntakeUrl(existingLead.id);

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match', [
            name || 'there',
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            name || 'there',
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    const { data: activeClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (activeClient) {
      return res.status(200).json({ action: 'active_client_msg', client_id: activeClient.id });
    }

    return res.status(200).json({ action: 'no_match' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
