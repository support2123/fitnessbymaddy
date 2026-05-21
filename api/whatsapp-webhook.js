const { getClient } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendToLead, logMessage, notifyMaddy } = require('./_lib/whatsapp');
const {
  maskPhone,
  detectMarket,
  normalizePhone,
  needsEscalation,
  classifyIntent,
  isHinglishMarket,
  PROGRAM_INFO,
  jsonResponse
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  /* ── CORS preflight ── */
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  /* ── Only POST allowed ── */
  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let phone;

  try {
    const { phone: rawPhone, message, name } = req.body || {};

    phone = normalizePhone(rawPhone || '');

    /* ── 3. Log incoming message ── */
    await logMessage(phone, 'in', message, null);

    const db = getClient();

    /* ── 4. Check existing client ── */
    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      if (needsEscalation(message)) {
        await notifyMaddy(
          'Active client needs attention',
          `Client: ${existingClient.name || 'Unknown'}\nPhone: ${maskPhone(phone)}\nMsg: ${message}`
        );
      }
      return jsonResponse(res, 200, { ok: true, action: 'existing_client' });
    }

    /* ── 5. Check leads table ── */
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    /* ── 5a. New lead ── */
    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market: detectMarket(phone)
      });

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return jsonResponse(res, 200, { ok: true, action: 'new_lead' });
    }

    /* ── 5b. Dropped lead ── */
    if (existingLead.status === 'dropped') {
      const intent = classifyIntent(message);
      // Whether OPTOUT or anything else, respect the drop — don't re-engage
      return jsonResponse(res, 200, { ok: true, action: 'dropped_lead' });
    }

    /* ── 5c. New or qualified lead ── */
    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      /* Update last_msg_at */
      await db
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      /* Check opt-out */
      const intent = classifyIntent(message);
      if (intent === 'OPTOUT') {
        await db
          .from('leads')
          .update({ status: 'dropped' })
          .eq('id', existingLead.id);
        return jsonResponse(res, 200, { ok: true, action: 'opted_out' });
      }

      /* Check escalation */
      if (needsEscalation(message)) {
        await notifyMaddy(
          'Lead needs attention',
          `Lead: ${existingLead.name || 'Unknown'}\nPhone: ${maskPhone(phone)}\nMsg: ${message}`
        );
      }

      /* Detect program interest */
      const program = intent; // classifyIntent already ran above
      if (program && PROGRAM_INFO[program]) {
        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${PROGRAM_INFO[program].checkout}`;
        const intakeUrl = `${process.env.SITE_URL}/intake?lead=${existingLead.id}`;

        let reply;
        if (isHinglishMarket(phone)) {
          reply =
            `Nice! ${PROGRAM_INFO[program].name} — bilkul sahi choice! 💪\n\n` +
            `Price: $${PROGRAM_INFO[program].price}\n\n` +
            `Checkout: ${checkoutUrl}\n\n` +
            `Pehle ye short form fill karo:\n${intakeUrl}`;
        } else {
          reply =
            `Great choice! ${PROGRAM_INFO[program].name} sounds perfect for you 💪\n\n` +
            `Price: $${PROGRAM_INFO[program].price}\n\n` +
            `Checkout here: ${checkoutUrl}\n\n` +
            `Please fill this quick form first:\n${intakeUrl}`;
        }

        const allowed = await canSendToLead(phone);
        if (allowed) {
          await sendText(phone, reply);
        }
      }
      /* If no program detected, don't reply — avoid spamming */

      return jsonResponse(res, 200, { ok: true, action: 'lead_updated' });
    }

    /* Fallback for any other lead status */
    return jsonResponse(res, 200, { ok: true, action: 'no_action' });
  } catch (err) {
    console.error(`[whatsapp-webhook] Error for ${maskPhone(phone || '')}: ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
