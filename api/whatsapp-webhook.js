const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { detectMarket } = require('./_lib/market');
const { KEYWORD_MAP, PROGRAMS } = require('./_lib/constants');

module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // AiSensy webhook payload — normalise fields
    const body = req.body || {};
    const phone = body.phone || body.mobile || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.sender_name || '';

    if (!phone) {
      console.warn('[whatsapp-webhook] Received payload with no phone');
      return res.status(200).json({ ok: true, note: 'no phone in payload' });
    }

    console.log(`[whatsapp-webhook] Incoming from ${maskPhone(phone)}`);

    // 1. Log inbound message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
    });

    const lowerMsg = message.toLowerCase().trim();

    // 2. Opt-out check
    if (lowerMsg === 'stop' || lowerMsg.includes('unsubscribe')) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', updated_at: new Date().toISOString() })
        .eq('phone', phone);

      console.log(`[whatsapp-webhook] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // 3. Escalation check
    const { flagged } = checkEscalation(message);
    if (flagged) {
      await notifyMaddy(
        'Escalation keyword detected in WhatsApp message',
        phone,
        message
      );

      await sendText(
        phone,
        "We've flagged this for Maddy personally. She'll reach out soon."
      );

      console.log(`[whatsapp-webhook] Escalation for ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    // 4. Check if lead exists
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // New lead
      const market = detectMarket(phone);

      const { error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName || null,
          status: 'new',
          market,
          source: 'whatsapp',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertErr) {
        console.error('[whatsapp-webhook] Lead insert error:', insertErr.message);
      }

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', {
        name: senderName || 'there',
      });

      console.log(`[whatsapp-webhook] New lead created for ${maskPhone(phone)}, market=${market}`);
      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    // 5. Existing lead — keyword matching
    const matchedEntry = KEYWORD_MAP.find((entry) =>
      entry.keywords.some((kw) => lowerMsg.includes(kw))
    );

    if (matchedEntry) {
      const program = PROGRAMS[matchedEntry.program];
      const programKey = matchedEntry.program;

      // Update lead with program interest
      await supabase
        .from('leads')
        .update({
          program_interest: programKey,
          updated_at: new Date().toISOString(),
        })
        .eq('phone', phone);

      // Build checkout URL (Exly)
      const checkoutUrl = `${process.env.EXLY_CHECKOUT_BASE || 'https://fitnessbymaddy.exlyapp.com/checkout'}/${programKey}`;
      const intakeUrl = `${process.env.INTAKE_FORM_URL || 'https://fitnessbymaddy.com/intake'}?lead_id=${existingLead.id}`;

      await sendText(
        phone,
        `Great news! Based on what you shared, the ${program.name} sounds perfect for you.\n\n` +
        `Checkout here: ${checkoutUrl}\n\n` +
        `Please also fill out this quick intake form so Maddy can personalise your plan: ${intakeUrl}`
      );

      console.log(`[whatsapp-webhook] Matched program ${programKey} for ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'program_matched', program: programKey });
    }

    // 6. No keyword match — generic reply
    await sendText(
      phone,
      "Thanks for reaching out! Could you tell us a bit more about your fitness goals? " +
      "For example: fat loss, muscle building, PCOS management, or something else?"
    );

    console.log(`[whatsapp-webhook] Generic reply to ${maskPhone(phone)}`);
    return res.status(200).json({ ok: true, action: 'generic_reply' });
  } catch (err) {
    console.error('[whatsapp-webhook] Unhandled error:', err.message);
    // Webhooks must always return 200 to avoid retries
    return res.status(200).json({ ok: false, error: 'internal' });
  }
};
