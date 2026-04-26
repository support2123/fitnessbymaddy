// api/whatsapp-webhook.js — Incoming WhatsApp message handler (AiSensy webhook)

const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const {
  maskPhone,
  detectMarket,
  isHinglish,
  parseLeadIntent,
  isOptOut,
} = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const EXLY_BASE = 'https://www.exlyapp.com/checkout';

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  // Webhooks must always return 200
  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, skipped: 'method_not_post' });
  }

  try {
    const { phone, message, name, timestamp } = req.body || {};

    if (!phone || !message) {
      console.log('[webhook] Empty payload — ignoring');
      return res.status(200).json({ ok: true, skipped: 'empty_payload' });
    }

    const masked = maskPhone(phone);
    console.log(`[webhook] Inbound from ${masked}: ${message.slice(0, 80)}`);

    // ── Log incoming message ────────────────────────────────────────
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      sent_at: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
      status: 'received',
    });

    // ── Opt-out check ───────────────────────────────────────────────
    if (isOptOut(message)) {
      console.log(`[webhook] Opt-out detected for ${masked}`);

      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);

      await sendText(
        phone,
        "You've been unsubscribed. If you ever want to restart, just message us. Take care!"
      );

      return res.status(200).json({ ok: true, action: 'opt_out' });
    }

    // ── Escalation check ────────────────────────────────────────────
    const escalation = checkEscalation(message);
    if (escalation.shouldEscalate) {
      console.log(`[webhook] Escalation for ${masked}: ${escalation.reason}`);

      await notifyMaddy(escalation.reason, {
        phone,
        messageBody: message,
      });

      await sendText(
        phone,
        'Thanks for sharing that. Our team will reach out to you shortly to help personally.'
      );

      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    // ── Lead lookup ─────────────────────────────────────────────────
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      // ── New lead ──────────────────────────────────────────────────
      const market = detectMarket(phone);

      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`[webhook] Lead insert failed for ${masked}:`, insertErr.message);
        return res.status(200).json({ ok: true, error: 'lead_insert_failed' });
      }

      console.log(`[webhook] New lead created: ${newLead.id} (${market})`);

      // Send welcome message based on market
      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [
          name || 'there',
        ]);
        // Fallback text in case template is not approved
        await sendText(
          phone,
          "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        );
      } else {
        await sendTemplate(phone, 'welcome_v1', [
          name || 'there',
        ]);
        await sendText(
          phone,
          "Hi! Maddy's team here \u{1F44B} What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Want to try a trial session first?"
        );
      }

      return res.status(200).json({ ok: true, action: 'new_lead', lead_id: newLead.id });
    }

    // ── Existing lead ─────────────────────────────────────────────
    // Update last_msg_at
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const intent = parseLeadIntent(message);

    if (intent) {
      console.log(`[webhook] Intent matched for ${masked}: ${intent.program}`);

      // Update program interest
      await supabase
        .from('leads')
        .update({
          program_interest: intent.program,
          status: 'qualified',
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `${EXLY_BASE}/${intent.checkoutSlug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_checkout', [
        existingLead.name || 'there',
        intent.program,
        checkoutUrl,
      ]);

      await sendText(
        phone,
        `Great choice! Here's your checkout link: ${checkoutUrl}\n\nAlso, please fill out this quick intake form so we can personalise your program: ${intakeUrl}`
      );

      return res.status(200).json({ ok: true, action: 'intent_matched', program: intent.program });
    }

    // No intent matched — send a nudge
    console.log(`[webhook] No intent matched for ${masked}, sending nudge`);

    await sendText(
      phone,
      "Tell us your main goal so we can recommend the right program — fat loss, PCOS, strength, 40+ fitness, or a trial session?"
    );

    return res.status(200).json({ ok: true, action: 'nudge_sent' });
  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message);
    return res.status(200).json({ ok: true, error: 'internal_error' });
  }
};
