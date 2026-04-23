const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, escalateToMaddy, checkOptOut } = require('./_lib/escalation');
const { qualifyLead, getProgramDetails } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = extractPhone(body);
    const text = extractText(body);
    const name = extractName(body);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming from ${maskPhone(phone)}: ${text ? text.substring(0, 50) : '[media]'}`);

    const db = getSupabase();

    await logMessage({ phone, direction: 'in', body: text });

    if (checkOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        context: text ? text.substring(0, 200) : 'No text',
      });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeValues = hinglish
        ? ['Hi! Maddy ki team se baat ho rahi hai. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ["Hi! You're speaking with Maddy's team. What's your goal — fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial first?"];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeValues,
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const program = qualifyLead(text);
    if (program) {
      const details = getProgramDetails(program);

      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const description = hinglish ? details.hinglish : details.english;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${details.checkout}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgValues = [
        description,
        `Checkout: ${checkoutUrl}`,
        `Intake form: ${intakeUrl}`,
      ];

      await sendWhatsApp({
        phone,
        templateName: 'program_offer',
        bodyValues: msgValues,
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPhone(body) {
  if (body.phone) return body.phone;
  if (body.mobile) return body.mobile;
  if (body.waId) return '+' + body.waId;
  if (body.payload?.sender?.phone) return body.payload.sender.phone;
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + body.entry[0].changes[0].value.messages[0].from;
  }
  return null;
}

function extractText(body) {
  if (body.text) return body.text;
  if (body.message) return body.message;
  if (body.payload?.payload?.text) return body.payload.payload.text;
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return body.entry[0].changes[0].value.messages[0].text.body;
  }
  return null;
}

function extractName(body) {
  if (body.name) return body.name;
  if (body.payload?.sender?.name) return body.payload.sender.name;
  if (body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return body.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
