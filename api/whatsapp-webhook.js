const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { checkEscalation } = require('./_lib/escalation');

// ── Program routing table ──────────────────────────────────────────
const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose'], program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'joint'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'transform'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try'], program: 'zoom_trial' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home' },
];

// ── Template names for each program ────────────────────────────────
const CHECKOUT_TEMPLATES = {
  '6wk_gym': 'checkout_6wk_gym',
  pcos: 'checkout_pcos',
  '40plus': 'checkout_40plus',
  '12wk': 'checkout_12wk',
  zoom_trial: 'checkout_zoom_trial',
  '6wk_home': 'checkout_6wk_home',
};

/**
 * Extract the message text and sender phone from either AiSensy or
 * Meta Cloud API webhook payloads.
 */
function parsePayload(body) {
  // AiSensy format — flat object with message, phone, name
  if (body.phone && (body.message || body.text)) {
    return {
      phone: body.phone,
      name: body.name || '',
      message: body.message || body.text || '',
    };
  }

  // Meta Cloud API format — nested entry > changes > value > messages
  try {
    const entry = (body.entry || [])[0];
    const change = (entry.changes || [])[0];
    const value = change.value || {};
    const msg = (value.messages || [])[0];
    const contact = (value.contacts || [])[0];

    if (msg) {
      return {
        phone: msg.from,
        name: (contact && contact.profile && contact.profile.name) || '',
        message: (msg.text && msg.text.body) || '',
      };
    }
  } catch (_) {
    // fall through
  }

  return null;
}

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route.program;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Meta webhook verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const parsed = parsePayload(req.body || {});

    if (!parsed || !parsed.phone) {
      // Nothing actionable — acknowledge so the webhook doesn't retry
      return res.status(200).json({ status: 'ignored', reason: 'no_message' });
    }

    const { phone, name, message } = parsed;
    const masked = maskPhone(phone);

    // ── Opt-out check ────────────────────────────────────────────
    const lower = (message || '').toLowerCase().trim();
    if (lower.includes('stop') || lower.includes('unsubscribe')) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', updated_at: new Date().toISOString() })
        .eq('phone', phone);

      console.log(`Opt-out processed for ${masked}`);
      return res.status(200).json({ status: 'opt_out' });
    }

    // ── Escalation check ─────────────────────────────────────────
    const escalation = checkEscalation(message);
    if (escalation.needsEscalation) {
      console.warn(`Escalation triggered for ${masked}: ${escalation.reason}`);
    }

    // ── Log inbound message ──────────────────────────────────────
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    // ── Lookup existing lead ─────────────────────────────────────
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      // ── FLOW A: brand-new lead ─────────────────────────────────
      const market = detectMarket(phone);

      const { error: insertErr } = await supabase.from('leads').insert({
        phone,
        name: name || null,
        status: 'new',
        market: market.market,
        language: market.language,
        source: 'whatsapp',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error(`Lead insert failed for ${masked}:`, insertErr.message);
      }

      await sendTemplate(phone, 'welcome_v1', {
        userName: name || phone,
        templateParams: [name || 'there'],
      });

      // Schedule a nudge 24h later via the nudge_queue table
      await supabase.from('nudge_queue').insert({
        phone,
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        template_name: 'nudge_after_welcome',
        status: 'pending',
      }).then(() => {}).catch(() => {});

      return res.status(200).json({ status: 'new_lead' });
    }

    // ── FLOW B: lead exists, status = new → route to program ─────
    if (lead.status === 'new') {
      const program = matchProgram(message);

      if (program) {
        await supabase
          .from('leads')
          .update({
            program_interest: program,
            status: 'qualified',
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id);

        const templateName = CHECKOUT_TEMPLATES[program] || 'checkout_generic';
        await sendTemplate(phone, templateName, {
          userName: name || lead.name || phone,
          templateParams: [name || lead.name || 'there'],
        });

        return res.status(200).json({ status: 'qualified', program });
      }

      // No keyword matched — send a gentle nudge to pick a program
      await sendText(
        phone,
        'Thanks for your message! Could you tell me more about your goal? ' +
        'Reply with something like "fat loss", "PCOS", "home workout", ' +
        '"custom program", or "trial" and I\'ll send you the right plan.'
      );

      return res.status(200).json({ status: 'awaiting_program_choice' });
    }

    // ── Status = qualified → remind about checkout ───────────────
    if (lead.status === 'qualified') {
      const templateName =
        CHECKOUT_TEMPLATES[lead.program_interest] || 'checkout_generic';

      await sendTemplate(phone, templateName, {
        userName: lead.name || phone,
        templateParams: [lead.name || 'there'],
      });

      return res.status(200).json({ status: 'checkout_reminder' });
    }

    // ── Status = converted → client support ──────────────────────
    if (lead.status === 'converted') {
      await sendText(
        phone,
        'Thanks for reaching out! Maddy\'s team has received your message ' +
        'and will get back to you shortly.'
      );

      return res.status(200).json({ status: 'client_support' });
    }

    // ── Fallback for any other status (dropped, etc.) ────────────
    return res.status(200).json({ status: 'no_action', lead_status: lead.status });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    // Always return 200 so the webhook provider doesn't retry
    return res.status(200).json({ status: 'error' });
  }
};
