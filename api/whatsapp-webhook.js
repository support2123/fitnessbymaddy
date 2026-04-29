const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender?.phone;
    const text = payload.text || payload.message?.text || payload.message?.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, text });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const { data: lead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      }).select().single();

      const greeting = isHinglish(market)
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const match = qualifyLead(text);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program,
        }).eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(match.program);
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const replyHinglish = `Great choice! ${match.name} program tumhare liye perfect hai ✨\n\n` +
          `💰 Price: $${match.price}\n` +
          `🔗 Checkout: ${checkoutUrl}\n\n` +
          `Registration ke baad yeh form bhi fill kardo:\n${intakeUrl}`;

        const replyEnglish = `Great choice! The ${match.name} program is perfect for you ✨\n\n` +
          `💰 Price: $${match.price}\n` +
          `🔗 Checkout: ${checkoutUrl}\n\n` +
          `After signing up, please fill out this form:\n${intakeUrl}`;

        const reply = isHinglish(market) ? replyHinglish : replyEnglish;

        if (await canSendMessage(phone)) {
          await sendText(phone, reply);
        }

        return res.json({ action: 'qualified', program: match.program });
      }
    }

    return res.json({ action: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
