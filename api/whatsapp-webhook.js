const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { mobile, message, name } = parsePayload(req.body);
    if (!mobile) return res.status(400).json({ error: 'No phone number' });

    const phone = normalizePhone(mobile);
    const market = detectMarket(phone);

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message,
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await sendTemplate(process.env.MADDY_PHONE || phone, 'escalation_alert', [
        maskPhone(phone), esc.keywords.join(', '), message.slice(0, 200),
      ]);
    }

    const { data: existing } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (!existing) {
      await supabase.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: message, market,
      });

      const greeting = isHinglish(market)
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendTemplate(phone, 'welcome_v1', [greeting]);
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const qualification = qualifyLead(message);
    if (qualification) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: qualification.program,
        last_msg_at: new Date().toISOString(),
      }).eq('phone', phone);

      const checkoutUrl = getCheckoutUrl(qualification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.id}`;

      const reply = isHinglish(market)
        ? `Great choice! 🔥 ${qualification.label} program perfect hai tere liye.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nKoi doubt ho toh puchh le!`
        : `Great choice! 🔥 The ${qualification.label} program is perfect for you.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nFeel free to ask any questions!`;

      await sendTemplate(phone, 'program_offer', [reply]);
      return res.status(200).json({ action: 'qualified', program: qualification.program });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('phone', phone);

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parsePayload(body) {
  // AiSensy webhook format
  if (body.mobile) {
    return { mobile: body.mobile, message: body.message?.text || body.text || '', name: body.name };
  }
  // Meta Cloud API format
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return { mobile: msg.from, message: msg.text?.body || '', name: contact?.profile?.name };
  }
  return { mobile: null, message: '', name: null };
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
