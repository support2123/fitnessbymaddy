const { supabase } = require('./lib/supabase');
const { detectMarket, canSendMessage, sendTemplate, sendTextMessage, needsEscalation, escalateToMaddy, maskPhone } = require('./lib/whatsapp');
const { qualifyLead, getCheckoutUrl, getIntakeFormUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (message.toLowerCase().match(/\b(stop|unsubscribe|opt.?out)\b/)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(phone, 'Keyword trigger', message);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      scheduleNudge(phone, newLead.id);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const matched = qualifyLead(message);
      if (matched) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'IN';
        const checkoutUrl = getCheckoutUrl(matched.program);
        const intakeUrl = getIntakeFormUrl(existingLead.id);

        const replyText = market === 'IN'
          ? `Perfect! ${matched.name} program tumhare liye best hai 💪\n\nPrice: $${matched.price}\n\n👉 Checkout: ${checkoutUrl}\n\n📝 Intake form bhi fill karo: ${intakeUrl}\n\nKoi question ho toh poochho!`
          : `Perfect! The ${matched.name} program is ideal for you 💪\n\nPrice: $${matched.price}\n\n👉 Checkout: ${checkoutUrl}\n\n📝 Please fill your intake form: ${intakeUrl}\n\nAny questions? Just ask!`;

        if (await canSendMessage(phone)) {
          await sendTextMessage(phone, replyText);
        }

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      const market = existingLead.market || 'IN';
      const fallbackText = market === 'IN'
        ? 'Got it! Kya specific goal hai? Fat loss, PCOS management, 40+ fitness, ya full 12-week transformation?'
        : 'Got it! What\'s your specific goal? Fat loss, PCOS management, 40+ fitness, or a full 12-week transformation?';

      if (await canSendMessage(phone)) {
        await sendTextMessage(phone, fallbackText);
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function scheduleNudge(phone, leadId) {
  // Nudge scheduling handled by /api/cron/nudge-dropped
  // The cron checks leads with status=new and last_msg_at > 2hrs ago
}
