const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { qualifyLead, isOptOut, PROGRAM_PRICES } = require('../lib/qualify');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.phone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', note: 'Routed to support queue' });
    }

    if (existingLead && existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead', note: 'No further messages' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

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

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const qualification = qualifyLead(text);

      if (qualification) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        const price = PROGRAM_PRICES[qualification.program] || 0;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        let msg;
        if (hinglish) {
          msg = `Great choice! ${qualification.label} program bilkul perfect hai tere liye.\n\nPrice: $${price}\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad yeh form fill kar dena:\n${intakeUrl}\n\nKoi question ho toh pooch!`;
        } else {
          msg = `Great choice! The ${qualification.label} program is perfect for you.\n\nPrice: $${price}\n\nCheckout here: ${checkoutUrl}\n\nAfter payment, fill out this form:\n${intakeUrl}\n\nAny questions? Just ask!`;
        }

        const allowed = await canSendToLead(phone);
        if (allowed) {
          await sendText(phone, msg);
        }

        return res.json({ action: 'qualified', program: qualification.program });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      return res.json({ action: 'reply_logged', note: 'No keyword match' });
    }

    return res.json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
