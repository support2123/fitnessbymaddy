const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendMessage, detectMarket } = require('./_lib/whatsapp');
const { checkAndEscalate } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/pii');

// Keyword → program mapping for qualification
const PROGRAM_RULES = [
  { pattern: /fat\s*loss|weight|shred/i, program: '6wk_gym', label: '6wk program' },
  { pattern: /pcos|hormonal/i, program: 'pcos', label: 'pcos program' },
  { pattern: /40|menopause|joints/i, program: '40plus', label: '40plus program' },
  { pattern: /custom|12\s*week|serious/i, program: '12wk', label: '12wk program' },
  { pattern: /trial|zoom|not\s*sure/i, program: 'zoom_trial', label: 'zoom_trial' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

const CHECKOUT_LINKS = {
  '6wk_gym': process.env.CHECKOUT_URL_6WK || 'https://exly.in/fitnessbymaddy/6wk',
  pcos: process.env.CHECKOUT_URL_PCOS || 'https://exly.in/fitnessbymaddy/pcos',
  '40plus': process.env.CHECKOUT_URL_40PLUS || 'https://exly.in/fitnessbymaddy/40plus',
  '12wk': process.env.CHECKOUT_URL_12WK || 'https://exly.in/fitnessbymaddy/12wk',
  zoom_trial: process.env.CHECKOUT_URL_TRIAL || 'https://exly.in/fitnessbymaddy/trial',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const phone = body.phone_number || body.mobile;
    const message = body.message || body.text || '';

    if (!phone) {
      console.warn('[webhook] Received request with no phone number');
      return res.status(400).json({ error: 'Missing phone number' });
    }

    console.log(`[webhook] Inbound from ${maskPhone(phone)}: "${message.slice(0, 80)}"`);

    // Log inbound message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    // Handle STOP / unsubscribe
    const lowerMsg = message.toLowerCase().trim();
    if (STOP_WORDS.some((w) => lowerMsg === w || lowerMsg.startsWith(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`[webhook] ${maskPhone(phone)} unsubscribed`);
      return res.status(200).json({ action: 'unsubscribed' });
    }

    // Check escalation keywords
    const esc = await checkAndEscalate(phone, message, { source: 'whatsapp_inbound' });
    if (esc.escalated) {
      console.warn(`[webhook] Escalation triggered for ${maskPhone(phone)}: ${esc.keywords}`);
    }

    // Look up existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if they are already a client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Existing client — don't auto-reply (human territory)
      console.log(`[webhook] Active client ${maskPhone(phone)} messaged — skipping auto-reply`);
      return res.status(200).json({ action: 'client_msg_logged' });
    }

    if (!existingLead) {
      // New lead
      const market = detectMarket(phone);
      const { error: insertErr } = await supabase.from('leads').insert({
        phone,
        status: 'new',
        first_msg: message,
        market,
        last_msg_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error(`[webhook] Failed to insert lead ${maskPhone(phone)}:`, insertErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', []);
      console.log(`[webhook] New lead ${maskPhone(phone)} — welcome sent (market=${market})`);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    // Existing lead with status 'new' — try to qualify
    if (existingLead.status === 'new') {
      let matched = null;
      for (const rule of PROGRAM_RULES) {
        if (rule.pattern.test(message)) {
          matched = rule;
          break;
        }
      }

      if (matched) {
        await supabase
          .from('leads')
          .update({
            program_interest: matched.program,
            status: 'qualified',
            last_msg_at: new Date().toISOString(),
          })
          .eq('id', existingLead.id);

        const checkoutLink = CHECKOUT_LINKS[matched.program] || '';
        const checkoutMsg =
          `Great choice! Here's your checkout link for the ${matched.label}:\n\n` +
          `${checkoutLink}\n\n` +
          `Once you complete payment, I'll get you set up right away!`;

        await sendMessage(phone, checkoutMsg);
        console.log(`[webhook] Lead ${maskPhone(phone)} qualified → ${matched.program}`);
        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      // No keyword match — update last_msg_at
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      console.log(`[webhook] Lead ${maskPhone(phone)} msg logged, no keyword match`);
      return res.status(200).json({ action: 'msg_logged' });
    }

    // Lead exists but is qualified/converted/dropped — just log
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    console.log(`[webhook] Lead ${maskPhone(phone)} (status=${existingLead.status}) msg logged`);
    return res.status(200).json({ action: 'msg_logged' });
  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
