const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, canSendMessage, logIncomingMessage } = require('../lib/whatsapp');
const { classifyIntent, detectMarket, isHinglishMarket, PROGRAM_INFO, maskPhone } = require('../lib/utils');
const { shouldEscalate, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name, senderName } = parsePayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    await logIncomingMessage(phone, message);

    const intent = classifyIntent(message);

    if (intent === 'OPT_OUT') {
      await db.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (intent === 'ESCALATE' || intent === 'ESCALATE_MEDICAL') {
      await escalateToMaddy({
        reason: intent === 'ESCALATE_MEDICAL' ? 'Medical/safety concern' : 'Sensitive keyword detected',
        phone,
        details: message,
      });
      return res.json({ action: 'escalated' });
    }

    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existing) {
      await db.from('leads').insert({
        phone,
        name: senderName || name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      if (await canSendMessage(phone)) {
        const welcomeBody = hinglish
          ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
          : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

        await sendWhatsApp({
          phone,
          templateName: 'welcome_v1',
          body: welcomeBody,
          params: [senderName || 'there'],
        });
      }

      return res.json({ action: 'new_lead_created' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existing.opted_out) {
      return res.json({ action: 'opted_out_lead_ignored' });
    }

    if (intent && PROGRAM_INFO[intent]) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent,
      }).eq('phone', phone);

      const info = PROGRAM_INFO[intent];
      if (await canSendMessage(phone)) {
        const qualifyBody = hinglish
          ? `Great choice! ${info.name} — $${info.price} mein ${info.weeks} weeks ka complete program milega.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existing.id}`
          : `Great choice! ${info.name} — $${info.price} for a complete ${info.weeks}-week program.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}\n\nPlease also fill out the intake form: https://fitnessbymaddy.com/intake?lead=${existing.id}`;

        await sendWhatsApp({
          phone,
          body: qualifyBody,
        });
      }

      return res.json({ action: 'lead_qualified', program: intent });
    }

    if (existing.status === 'new' && !intent) {
      if (await canSendMessage(phone)) {
        const nudgeBody = hinglish
          ? "Koi specific goal batao na — fat loss, PCOS, 40+ fitness? Ya $20 mein ek trial zoom session try karo!"
          : "Could you share your specific goal — fat loss, PCOS, 40+ fitness? Or try a $20 trial zoom session!";
        await sendWhatsApp({ phone, body: nudgeBody });
      }
    }

    return res.json({ action: 'message_processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};
  if (body.phone) return body;
  if (body.mobile) return { phone: body.mobile, message: body.text || body.message, senderName: body.name };
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      const contact = change.contacts?.[0];
      return {
        phone: '+' + msg.from,
        message: msg.text?.body || msg.button?.text || '',
        senderName: contact?.profile?.name,
      };
    }
  }
  return {};
}
