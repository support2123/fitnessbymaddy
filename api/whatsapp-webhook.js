const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { checkEscalation } = require('../lib/escalation');
const { detectMarket, getLanguage } = require('../lib/market');

/**
 * Masks a phone number for safe logging: +91XXXXX67890 → +91XXXXX***90
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

/**
 * Keyword qualification patterns mapped to program interest and template info.
 */
const QUALIFICATION_RULES = [
  {
    pattern: /fat\s*loss|weight|shred/i,
    program: '6wk_gym',
    template: 'checkout_intake_v1',
  },
  {
    pattern: /pcos|hormonal/i,
    program: 'pcos',
    template: 'checkout_intake_v1',
  },
  {
    pattern: /40|menopause|joints/i,
    program: '40plus',
    template: 'checkout_intake_v1',
  },
  {
    pattern: /custom|12\s*week|serious/i,
    program: '12wk',
    template: 'checkout_intake_v1',
  },
  {
    pattern: /trial|zoom|not\s*sure/i,
    program: 'zoom_trial',
    template: 'trial_link_v1',
  },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();

    /* ── Parse incoming AiSensy webhook payload ── */
    const payload = req.body || {};
    const phone = (payload.phone || payload.from || '').replace(/\s+/g, '');
    const body = (payload.message || payload.text || payload.body || '').trim();

    if (!phone) {
      return res.status(200).json({ ok: true, note: 'no phone in payload' });
    }

    /* ── Opt-out check ── */
    if (/\b(stop|unsubscribe)\b/i.test(body)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', updated_at: new Date().toISOString() })
        .eq('phone', phone);

      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    /* ── Escalation check ── */
    const escalated = await checkEscalation(body, phone);

    /* ── Log inbound message ── */
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body,
      escalated: !!escalated,
      created_at: new Date().toISOString(),
    });

    /* ── Look up existing lead ── */
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      /* ── New lead ── */
      const market = detectMarket(phone);
      const language = getLanguage(market);

      await supabase.from('leads').insert({
        phone,
        market,
        language,
        status: 'new',
        last_msg_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      await sendWhatsApp(phone, 'welcome_v1', { language });

      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    /* ── Update last message timestamp ── */
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      /* ── Keyword qualification ── */
      let matched = false;

      for (const rule of QUALIFICATION_RULES) {
        if (rule.pattern.test(body)) {
          await supabase
            .from('leads')
            .update({
              program_interest: rule.program,
              status: 'qualified',
              updated_at: new Date().toISOString(),
            })
            .eq('phone', phone);

          const params = {
            program: rule.program,
            checkout_url: `https://fitnessbymaddy.com/checkout?p=${rule.program}&ph=${encodeURIComponent(phone)}`,
            intake_url: `https://fitnessbymaddy.com/intake.html?ph=${encodeURIComponent(phone)}`,
          };

          await sendWhatsApp(phone, rule.template, params);
          matched = true;
          break;
        }
      }

      if (!matched) {
        /* ── No keyword match — ask for clarification ── */
        await sendWhatsApp(phone, 'clarify_goal_v1', {
          name: existingLead.name || '',
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    const safePhone = maskPhone((req.body || {}).phone || '');
    console.error(`whatsapp-webhook error [${safePhone}]:`, err.message);
    // Always return 200 so the webhook provider doesn't retry endlessly
    return res.status(200).json({ ok: true, note: 'processed' });
  }
};
