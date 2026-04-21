const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  detectProgram, maskPhone, PROGRAM_NAMES, errorResponse, jsonResponse
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const db = getSupabase();

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) return errorResponse(res, 'Missing phone or message');

    await db.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return jsonResponse(res, { action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await db.from('escalations').insert({
        phone, reason: 'keyword_trigger', message_body: message
      });
      await notifyMaddy('Keyword escalation', `Phone: ${maskPhone(phone)}\nMsg: ${message}`);
    }

    const { data: existingClient } = await db
      .from('clients').select('id,status').eq('phone', phone).eq('status', 'active').single();

    if (existingClient) {
      return jsonResponse(res, { action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads').select('*').eq('phone', phone).single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return jsonResponse(res, { action: 'lead_dropped' });
      }

      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified', program_interest: program
        }).eq('id', existingLead.id);

        await sendQualificationMessage(phone, program, existingLead.id, detectMarket(phone));
        return jsonResponse(res, { action: 'qualified', program });
      }

      return jsonResponse(res, { action: 'existing_lead' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone, name: name || null, source: 'whatsapp',
      status: 'new', first_msg: message,
      last_msg_at: new Date().toISOString(), market
    }).select().single();

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
    } else {
      await sendTextMessage(phone,
        `Hi${name ? ' ' + name : ''}! Welcome to Fitness by Maddy 👋\n\n` +
        `What's your goal — fat loss, PCOS management, strength, 40+ fitness, or want to try a trial session first?`
      );
    }

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified', program_interest: program
      }).eq('id', newLead.id);
      await sendQualificationMessage(phone, program, newLead.id, market);
    }

    return jsonResponse(res, { action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.payload) {
    return {
      phone: body.payload.sender?.phone || body.payload.from,
      message: body.payload.text || body.payload.body,
      name: body.payload.sender?.name || body.payload.profile_name
    };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from ? `+${msg.from}` : null,
      message: msg?.text?.body || msg?.button?.text,
      name: contact?.profile?.name
    };
  }
  return {};
}

async function sendQualificationMessage(phone, program, leadId, market) {
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  const hinglish = isHinglish(market);

  const text = hinglish
    ? `Great choice! 🔥\n\n` +
      `*${programName}* — yeh program tumhare liye perfect hai.\n\n` +
      `➡️ Checkout: ${checkoutUrl}\n` +
      `➡️ Intake form bhar do: ${intakeUrl}\n\n` +
      `Payment ke baad turant program start ho jayega!`
    : `Great choice! 🔥\n\n` +
      `*${programName}* is a perfect fit for your goal.\n\n` +
      `➡️ Checkout here: ${checkoutUrl}\n` +
      `➡️ Fill your intake form: ${intakeUrl}\n\n` +
      `Your program starts right after payment!`;

  await sendTextMessage(phone, text);
}
