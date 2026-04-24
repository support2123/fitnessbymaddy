const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, logMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('./lib/escalation');
const { canSendToLead } = require('./lib/rate-limit');
const { matchProgram, getCheckoutUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const { phone, body, name } = message;
    const db = getSupabase();

    await logMessage(phone, 'in', body, null);

    if (isOptOut(body)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await notifyMaddy('Keyword flag from user', `Phone: ${maskPhone(phone)}\nMessage: ${body}`);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ ok: true, action: 'active_client_msg_logged' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await db
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
      }

      const programMatch = matchProgram(body);
      if (programMatch) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: programMatch.program,
          })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const checkoutUrl = getCheckoutUrl(programMatch.program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (await canSendToLead(phone)) {
          if (isHinglish(market)) {
            await sendText(
              phone,
              `Perfect choice! 🎯 ${programMatch.label} aapke liye best rahega.\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Pehle ye form bhar do taaki hum aapka plan customize kar sakein:\n${intakeUrl}`
            );
          } else {
            await sendText(
              phone,
              `Great choice! 🎯 ${programMatch.label} is perfect for your goals.\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Please fill this form so we can customise your plan:\n${intakeUrl}`
            );
          }
        }

        return res.status(200).json({ ok: true, action: 'qualified', program: programMatch.program });
      }

      return res.status(200).json({ ok: true, action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db
      .from('leads')
      .insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [
        name || 'there',
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [
        name || 'there',
      ]);
    }

    return res.status(200).json({ ok: true, action: 'new_lead', id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'handled' });
  }
};

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      body: msg.text?.body || '',
      name: contact?.profile?.name || null,
    };
  }

  if (payload?.phone && payload?.message) {
    return {
      phone: payload.phone,
      body: payload.message,
      name: payload.name || null,
    };
  }

  return null;
}
