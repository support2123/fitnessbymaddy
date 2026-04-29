const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { checkEscalation } = require('./_lib/escalation');
const {
  PROGRAM_MAP,
  CHECKOUT_BASE_URL,
  FORM_BASE_URL,
  OPT_OUT_KEYWORDS,
} = require('./_lib/constants');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    // Assume India if no country code
    cleaned = cleaned.length === 10 ? `+91${cleaned}` : `+${cleaned}`;
  }
  return cleaned;
}

function extractPayload(body) {
  // AiSensy can send in multiple formats
  let phone = null;
  let message = null;

  // Format 1: flat fields
  if (body.phone) {
    phone = body.phone;
  }
  if (body.message && typeof body.message === 'string') {
    message = body.message;
  }

  // Format 2: nested data.contacts / data.message
  if (body.data) {
    if (body.data.contacts && body.data.contacts[0] && body.data.contacts[0].wa_id) {
      phone = body.data.contacts[0].wa_id;
    }
    if (body.data.message && body.data.message.text && body.data.message.text.body) {
      message = body.data.message.text.body;
    }
  }

  return { phone, message };
}

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const [keyword, info] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) {
      return info;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({}).setHeader
      ? (Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v)),
        res.status(200).end())
      : res.status(200).end();
  }

  // Set CORS headers for all responses
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone: rawPhone, message: messageBody } = extractPayload(req.body || {});
    const phone = normalizePhone(rawPhone);

    if (!phone || !messageBody) {
      console.warn('Webhook received with missing phone or message body');
      return res.status(200).json({ status: 'ignored', reason: 'missing_data' });
    }

    // Log incoming message
    const { error: logError } = await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      sent_at: new Date().toISOString(),
      status: 'received',
    });
    if (logError) {
      console.error(`Failed to log inbound message for ${maskPhone(phone)}:`, logError.message);
    }

    // Check opt-out
    const lowerMsg = messageBody.toLowerCase().trim();
    const isOptOut = OPT_OUT_KEYWORDS.some((kw) => lowerMsg === kw || lowerMsg.includes(kw));
    if (isOptOut) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', updated_at: new Date().toISOString() })
        .eq('phone', phone);

      await sendText(phone, "You've been unsubscribed. Take care!");
      return res.status(200).json({ status: 'opt_out' });
    }

    // Check escalation triggers
    const { escalated } = await checkEscalation(messageBody, phone);
    if (escalated) {
      await sendText(phone, 'Maddy will personally reach out to you shortly.');
      return res.status(200).json({ status: 'escalated' });
    }

    // Look up lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (leadError && leadError.code !== 'PGRST116') {
      // PGRST116 = no rows found, anything else is a real error
      console.error(`Lead lookup failed for ${maskPhone(phone)}:`, leadError.message);
    }

    // FLOW A: New lead - not found in database
    if (!lead) {
      const market = detectMarket(phone);

      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          phone,
          status: 'new',
          market,
          source: 'whatsapp',
          first_msg: messageBody,
          last_msg_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        console.error(`Failed to insert lead for ${maskPhone(phone)}:`, insertError.message);
        return res.status(200).json({ status: 'error', reason: 'insert_failed' });
      }

      await sendTemplate(phone, 'welcome_v1');
      return res.status(200).json({ status: 'new_lead', lead_id: newLead?.id });
    }

    // FLOW B: Lead exists with status 'new' - qualify them
    if (lead.status === 'new') {
      const matched = matchProgram(messageBody);

      if (matched) {
        await supabase
          .from('leads')
          .update({
            program_interest: matched.program,
            status: 'qualified',
            last_msg_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        const checkoutLink = `${CHECKOUT_BASE_URL}${matched.program}`;
        const formLink = `${FORM_BASE_URL}/intake?lead_id=${lead.id}`;

        await sendText(
          phone,
          `Great choice! Here's your checkout link for ${matched.name} ($${matched.price}):\n${checkoutLink}\n\nPlease also fill out your intake form:\n${formLink}`
        );
      } else {
        // No program keyword matched - send a nudge
        await sendText(
          phone,
          "Thanks for your message! Could you tell me a bit about your fitness goal? For example: fat loss, PCOS, 40+ fitness, or a custom 12-week plan?"
        );
      }

      return res.status(200).json({ status: 'qualified', program: matched?.program || null });
    }

    // Lead exists with status 'qualified' - remind about checkout
    if (lead.status === 'qualified') {
      const program = lead.program_interest;
      const programInfo = Object.values(PROGRAM_MAP).find((p) => p.program === program);
      const checkoutLink = `${CHECKOUT_BASE_URL}${program || ''}`;

      await sendText(
        phone,
        `Hey! Just a reminder - your checkout link${programInfo ? ` for ${programInfo.name}` : ''} is ready:\n${checkoutLink}\n\nLet me know if you have any questions!`
      );

      return res.status(200).json({ status: 'reminder_sent' });
    }

    // Lead exists with status 'converted' - they're a client
    if (lead.status === 'converted') {
      // Acknowledge - they're already a paying client
      await sendText(
        phone,
        "Got your message! As a client, Maddy or her team will get back to you shortly."
      );
      return res.status(200).json({ status: 'client_message_forwarded' });
    }

    // Catch-all for any other status (dropped, etc.)
    return res.status(200).json({ status: 'no_action', lead_status: lead.status });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    // Always return 200 for webhooks to prevent retries
    return res.status(200).json({ status: 'error' });
  }
};
