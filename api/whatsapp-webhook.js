const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, maskPhone, classifyIntent, getWelcomeMessage, getProgramMessage, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') {
    return errorResponse(res, 'Method not allowed', 405);
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) return jsonResponse(res, { status: 'no_message' });

    const { phone, text, name } = message;
    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    const intent = classifyIntent(text);

    if (intent === 'OPTOUT') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return jsonResponse(res, { status: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await notifyMaddy(
        'Message needs review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
      return jsonResponse(res, { status: 'escalated' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status, program')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await notifyMaddy(
        'Active client message',
        `Phone: ${maskPhone(phone)}\nProgram: ${existingClient.program}\nMessage: ${text}`
      );
      return jsonResponse(res, { status: 'client_message_forwarded' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      if (existingLead.status === 'dropped') {
        return jsonResponse(res, { status: 'dropped_lead_ignored' });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
        ...(intent && intent !== 'OPTOUT' && intent !== 'ESCALATE'
          ? { program_interest: intent, status: 'qualified' }
          : {})
      }).eq('id', existingLead.id);

      if (intent && intent !== 'OPTOUT' && intent !== 'ESCALATE') {
        const market = existingLead.market || detectMarket(phone);
        const programMsg = getProgramMessage(intent, market);
        if (programMsg) {
          await sendText(phone, programMsg);
          const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
          await sendText(phone, `📋 Intake form: ${intakeLink}`);
        }
      }

      return jsonResponse(res, { status: 'lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const welcome = getWelcomeMessage(market);
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);

    if (intent && intent !== 'OPTOUT' && intent !== 'ESCALATE') {
      await db.from('leads').update({
        program_interest: intent,
        status: 'qualified'
      }).eq('id', newLead.id);

      const programMsg = getProgramMessage(intent, market);
      if (programMsg) {
        await sendText(phone, programMsg);
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${newLead.id}`;
        await sendText(phone, `📋 Intake form: ${intakeLink}`);
      }
    }

    return jsonResponse(res, { status: 'new_lead_created', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (payload?.phone && payload?.message) {
    return {
      phone: payload.phone,
      text: payload.message,
      name: payload.name || null
    };
  }

  if (payload?.sender?.phone && payload?.text) {
    return {
      phone: payload.sender.phone,
      text: payload.text,
      name: payload.sender.name || null
    };
  }

  return null;
}
