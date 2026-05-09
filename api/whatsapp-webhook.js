const { getClient } = require('../lib/supabase');
const { sendWhatsApp, logInbound } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

const WELCOME_EN = "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a $20 trial session first?";
const WELCOME_HI = "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";

const NUDGE_TRIAL_EN = "Hey! Just checking in. Would you like to try a quick $20 Zoom trial session with Maddy? No commitment — see if it's a fit. Link: https://fitnessbymaddy.com/intake?program=zoom_trial";
const NUDGE_TRIAL_HI = "Hey! Bas check kar rahe the. $20 mein ek Zoom trial session try karna chahoge Maddy ke saath? Link: https://fitnessbymaddy.com/intake?program=zoom_trial";

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getClient();

  try {
    const { phone, message, name: senderName } = parsePayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logInbound(phone, message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out processed for ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in inbound message', {
        phone, name: senderName, message
      });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'existing_client', clientId: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select('id').single();

      const welcome = hinglish ? WELCOME_HI : WELCOME_EN;
      await sendWhatsApp(phone, welcome, 'welcome_v1', false);

      return res.status(200).json({ action: 'new_lead', leadId: newLead.id });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead', leadId: existingLead.id });
    }

    const match = qualifyLead(message);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program
      }).eq('id', existingLead.id);

      const checkoutMsg = hinglish
        ? `Great choice! ${match.name} program ($${match.price}). Yahan se checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
        : `Great choice! ${match.name} program ($${match.price}). Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}\n\nAlso fill your intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, checkoutMsg, null, false);
      return res.status(200).json({ action: 'qualified', program: match.program });
    }

    return res.status(200).json({ action: 'unmatched_reply', leadId: existingLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  if (!body) return {};
  if (body.phone) return body;
  if (body.entry) {
    try {
      const change = body.entry[0].changes[0].value;
      const msg = change.messages && change.messages[0];
      if (msg) {
        return {
          phone: '+' + msg.from,
          message: msg.text ? msg.text.body : '',
          name: change.contacts && change.contacts[0] ? change.contacts[0].profile.name : ''
        };
      }
    } catch (_) {}
  }
  if (body.message) {
    return { phone: body.mobile || body.phone || '', message: body.message, name: body.name || '' };
  }
  return {};
}
