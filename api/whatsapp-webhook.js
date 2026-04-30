const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');
const { canSendTo, logMessage } = require('../lib/rate-limit');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from || '';
    const messageText = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage({ phone, direction: 'in', body: messageText });

    if (isOptOut(messageText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy({ phone, reason: 'keyword_trigger', messageText });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, market')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', clientId: existingClient.id });
    }

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText,
        last_msg_at: new Date().toISOString(),
        market,
      }).select('id').single();

      const canSend = await canSendTo(phone);
      if (canSend) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
        await logMessage({
          phone,
          direction: 'out',
          templateName: 'welcome_v1',
          body: hinglish
            ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
            : 'Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Want to try a trial first?',
        });
      }

      return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const match = qualifyLead(messageText);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
      }).eq('id', existingLead.id);

      const canSend = await canSendTo(phone);
      if (canSend) {
        const checkoutUrl = getCheckoutUrl(match.program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? `Great choice! ${match.label} ($${match.price}) perfect hai tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
          : `Great choice! ${match.label} ($${match.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

        await sendText(phone, msg);
        await logMessage({ phone, direction: 'out', body: msg, templateName: 'qualification_reply' });
      }

      return res.status(200).json({ action: 'qualified', program: match.program });
    }

    return res.status(200).json({ action: 'existing_lead_unmatched' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
