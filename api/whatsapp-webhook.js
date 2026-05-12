const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { normalizePhone, detectMarket, maskPhone } = require('../lib/phone');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { matchProgram } = require('../lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.senderPhone || payload.from || payload.waId);
    const text = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming({ phone, body: text });

    const lower = text.toLowerCase();
    if (lower === 'stop' || lower === 'unsubscribe') {
      const db = getSupabase();
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Lead message flagged',
        phone,
        context: text.slice(0, 200),
      });
    }

    const db = getSupabase();
    const { data: existing } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existing) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeMsg = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        params: [name || 'there'],
        body: welcomeMsg,
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);

    const programMatch = matchProgram(text);
    if (programMatch) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: programMatch.program,
      }).eq('id', existing.id);

      const market = detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.id}`;

      const msg = market === 'IN'
        ? `Great choice! ${programMatch.name} perfect hai tumhare liye. 💪\n\nPrice: $${programMatch.price}\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill kar do: ${intakeUrl}`
        : `Great choice! ${programMatch.name} is perfect for you. 💪\n\nPrice: $${programMatch.price}\n\nCheckout: ${checkoutUrl}\n\nPlease also fill out the intake form: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        params: [programMatch.name, String(programMatch.price), checkoutUrl, intakeUrl],
        body: msg,
      });

      return res.status(200).json({ action: 'qualified', program: programMatch.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.senderPhone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
