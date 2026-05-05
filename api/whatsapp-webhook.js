const { supabase } = require('./lib/supabase');
const { sendTemplate, checkRateLimit, maskPhone, detectMarket, normalizePhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const messageText = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: messageText.substring(0, 500),
      status: 'received'
    });

    const lower = messageText.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy(
        'Flagged message from lead',
        `Phone: ${maskPhone(phone)}\nMessage: ${messageText.substring(0, 200)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageText.substring(0, 500),
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const isHinglish = market === 'IN';
      const welcomeTemplate = isHinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const match = qualifyLead(messageText);
      if (match) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program
          })
          .eq('id', existingLead.id);

        const rateLimited = await checkRateLimit(phone);
        if (!rateLimited) {
          const market = detectMarket(phone);
          const checkoutUrl = getCheckoutUrl(match.program);
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          if (market === 'IN') {
            await sendTemplate(phone, 'program_match_hi', [
              senderName || 'there',
              match.programName,
              `$${match.price}`,
              checkoutUrl,
              intakeUrl
            ]);
          } else {
            await sendTemplate(phone, 'program_match', [
              senderName || 'there',
              match.programName,
              `$${match.price}`,
              checkoutUrl,
              intakeUrl
            ]);
          }
        }

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
