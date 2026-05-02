const supabase = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { checkAndEscalate } = require('./_lib/escalation');

function normalizePhone(raw) {
  let phone = String(raw).replace(/[^0-9]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

const QUALIFICATION_RULES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'transform'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try'], program: 'zoom_trial' },
];

function qualifyMessage(text) {
  const lower = text.toLowerCase();
  for (const rule of QUALIFICATION_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.program;
    }
  }
  return null;
}

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddy.exly.app/6-week-shred',
  pcos: 'https://fitnessbymaddy.exly.app/pcos-program',
  '40plus': 'https://fitnessbymaddy.exly.app/40-plus',
  '12wk': 'https://fitnessbymaddy.exly.app/12-week-custom',
  zoom_trial: 'https://fitnessbymaddy.exly.app/zoom-trial',
};

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Gym Shred',
  pcos: 'PCOS Program',
  '40plus': '40+ Fitness',
  '12wk': '12-Week Custom Training',
  zoom_trial: 'Zoom Trial Session',
};

function buildCheckoutMessage(program, market) {
  const link = CHECKOUT_LINKS[program] || CHECKOUT_LINKS.zoom_trial;
  const label = PROGRAM_LABELS[program] || program;

  if (isHinglish(market)) {
    return (
      `Great choice! Aapke liye *${label}* perfect rahega.\n\n` +
      `Yahan se enroll karein: ${link}\n\n` +
      `Intake form bhi fill karein taaki hum aapka program customize kar sakein: ` +
      `https://fitnessbymaddy.com/intake`
    );
  }

  return (
    `Great choice! The *${label}* is perfect for your goals.\n\n` +
    `Enroll here: ${link}\n\n` +
    `Please also fill out the intake form so we can customise your program: ` +
    `https://fitnessbymaddy.com/intake`
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const phone = normalizePhone(body.contactNumber);
    const messageText = String(body.message || '').trim();
    const masked = maskPhone(phone);

    if (!messageText) {
      return res.status(200).json({ ok: true, note: 'empty message' });
    }

    // Opt-out handling
    const lowerMsg = messageText.toLowerCase();
    if (lowerMsg.includes('stop') || lowerMsg.includes('unsubscribe')) {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (existingLead) {
        await supabase
          .from('leads')
          .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
          .eq('id', existingLead.id);
        console.log(`Lead ${masked} opted out`);
      }
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Log incoming message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      content: messageText,
    });

    // Check escalation triggers
    await checkAndEscalate(phone, messageText, 'whatsapp', null);

    // Look up existing lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const market = detectMarket(phone);

    if (!lead) {
      // New lead
      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          status: 'new',
          first_msg: messageText,
          market,
          last_msg_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error(`Failed to insert lead ${masked}:`, insertErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }

      // Send welcome template
      await sendTemplate(phone, 'welcome_v1', []);

      // Log nudge scheduling (the cron will handle actual nudges)
      console.log(`Nudge scheduled for new lead ${masked} (id: ${newLead.id})`);

      return res.status(200).json({ ok: true, action: 'new_lead', lead_id: newLead.id });
    }

    if (lead.status === 'new') {
      // Attempt keyword qualification
      const program = qualifyMessage(messageText);

      if (program) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: program,
            last_msg_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        const checkoutMsg = buildCheckoutMessage(program, market);
        await sendText(phone, checkoutMsg);

        return res
          .status(200)
          .json({ ok: true, action: 'qualified', program, lead_id: lead.id });
      }

      // No keyword matched -- update last_msg_at only
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      return res.status(200).json({ ok: true, action: 'awaiting_qualification', lead_id: lead.id });
    }

    // Lead is already qualified or converted -- ack for now
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    return res.status(200).json({ ok: true, action: 'active_client_ack', lead_id: lead.id });
  } catch (err) {
    console.error('whatsapp-webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
