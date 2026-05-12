const { supabase } = require('../lib/supabase');
const { sendTemplate, sendTextMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (text.toLowerCase().includes('stop') || text.toLowerCase().includes('unsubscribe')) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { name, phone, message: text });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'existing_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, status: 'new', first_msg: text, market, source: 'whatsapp'
      }).select().single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: hinglish
          ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
          : ['Hi! Maddy\'s team here. What\'s your fitness goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?']
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    const match = qualifyLead(text);
    if (match) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(match.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const hinglish = isHinglish(market);

      await sendTemplate(phone, 'program_match', {
        name: name || 'there',
        templateParams: hinglish
          ? [match.label, checkoutUrl, intakeUrl]
          : [match.label, checkoutUrl, intakeUrl]
      });

      return res.status(200).json({ action: 'qualified', program: match.program });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
