const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { checkEscalation } = require('./_lib/escalation');

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return '***' + phone.slice(-3);
}

function extractPayload(body) {
  // AiSensy can send various formats — handle flexibly
  let phone = null;
  let text = null;
  let contactName = null;

  // Format 1: { message: { text, from }, contact: { name } }
  if (body.message) {
    text = body.message.text || body.message.body || null;
    phone = body.message.from || body.message.phone || null;
  }

  if (body.contact) {
    contactName = body.contact.name || body.contact.profile?.name || null;
  }

  // Format 2: flat structure
  if (!phone) phone = body.from || body.phone || body.sender || null;
  if (!text) text = body.text || body.body || null;
  if (!contactName) contactName = body.name || body.senderName || null;

  // Format 3: nested entry/changes (Meta-style)
  if (!phone && body.entry) {
    try {
      const change = body.entry[0].changes[0].value;
      const msg = change.messages?.[0];
      if (msg) {
        phone = msg.from;
        text = msg.text?.body || msg.body || null;
      }
      contactName = contactName || change.contacts?.[0]?.profile?.name || null;
    } catch (_) {
      // ignore nested extraction failure
    }
  }

  // Normalize phone — ensure it starts with +
  if (phone) {
    phone = phone.replace(/\s+/g, '');
    if (!phone.startsWith('+')) phone = '+' + phone;
  }

  return { phone, text, contactName };
}

const QUALIFICATION_RULES = [
  {
    keywords: ['fat loss', 'weight', 'shred'],
    program: '6wk_gym',
    template: 'checkout_link',
  },
  {
    keywords: ['pcos', 'hormonal'],
    program: 'pcos',
    template: 'checkout_link',
  },
  {
    keywords: ['40', 'menopause', 'joints'],
    program: '40plus',
    template: 'checkout_link',
  },
  {
    keywords: ['custom', '12 week', 'serious'],
    program: '12wk',
    template: 'checkout_link',
  },
  {
    keywords: ['trial', 'zoom', 'not sure'],
    program: 'zoom_trial',
    template: 'trial_link',
  },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const rule of QUALIFICATION_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const { phone, text, contactName } = extractPayload(req.body || {});

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    // Log inbound message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text || '',
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    // Check opt-out
    if (text && /^(stop|unsubscribe)$/i.test(text.trim())) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Check for escalation keywords
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    await checkEscalation(phone, text, existingClient?.id || null);

    // Look up lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      // New lead
      const market = detectMarket(phone);
      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name: contactName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: text || '',
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error(`Lead insert error for ${maskPhone(phone)}:`, insertErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }

      await sendTemplate(phone, 'welcome_v1', [contactName || 'there']);
      return res.status(200).json({ ok: true, action: 'new_lead', lead_id: newLead.id });
    }

    // Update last_msg_at
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    // If lead is new, attempt keyword qualification
    if (lead.status === 'new') {
      const match = matchProgram(text);

      if (match) {
        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
          })
          .eq('id', lead.id);

        await sendTemplate(phone, match.template, [
          contactName || lead.name || 'there',
          match.program,
        ]);

        return res.status(200).json({
          ok: true,
          action: 'qualified',
          program: match.program,
        });
      }

      // No keyword match — send re-engagement
      await sendText(
        phone,
        "Hey! Thanks for reaching out to FitnessByMaddy. Could you tell me a bit about your fitness goals? Are you looking for fat loss, strength training, PCOS management, or something else? I'd love to help you find the right program!"
      );

      return res.status(200).json({ ok: true, action: 're_engagement' });
    }

    // For qualified/converted/dropped leads, just acknowledge
    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    const { phone } = extractPayload(req.body || {});
    console.error(`WhatsApp webhook error for ${maskPhone(phone)}:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
