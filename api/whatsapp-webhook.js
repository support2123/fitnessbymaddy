const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  maskPhone, jsonResponse, programLabel,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const incomingText = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: incomingText,
    });

    if (isOptOut(incomingText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(incomingText)) {
      await notifyMaddy(
        'Lead message needs review',
        `Phone: ${maskPhone(phone)}\nMessage: "${incomingText.slice(0, 200)}"`
      );
      await sendWhatsApp({
        phone,
        body: "Thanks for sharing that — I've flagged this for Maddy to personally review. She'll get back to you shortly.",
      });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const program = detectProgram(incomingText);

      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: incomingText,
        last_msg_at: new Date().toISOString(),
        program_interest: program,
        market,
      });

      const welcomeMsg = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({ phone, body: welcomeMsg });
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(incomingText);

      if (program) {
        await db.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const label = programLabel(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const isIN = existingLead.market === 'IN';
        const qualifyMsg = isIN
          ? `Great choice! 💪 "${label}" is perfect for your goal.\n\n📋 Step 1: Fill your intake form:\n${intakeUrl}\n\n💳 Step 2: Complete payment:\n${checkoutUrl}\n\nKoi question ho toh poocho!`
          : `Great choice! 💪 "${label}" is perfect for your goal.\n\n📋 Step 1: Fill your intake form:\n${intakeUrl}\n\n💳 Step 2: Complete payment:\n${checkoutUrl}\n\nFeel free to ask any questions!`;

        await sendWhatsApp({ phone, body: qualifyMsg });
        return res.status(200).json({ action: 'lead_qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
