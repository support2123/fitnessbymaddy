'use strict';

const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, createEscalation } = require('./lib/escalation');

// ─── keyword → program interest map ────────────────────────────────────────
const KEYWORD_PROGRAMS = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose'],          program: '6wk_gym' },
  { keywords: ['pcos', 'hormonal', 'period', 'hormone'],        program: 'pcos' },
  { keywords: ['40', 'menopause', 'joint', 'age'],              program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'transform'],    program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try'],             program: 'zoom_trial' },
  { keywords: ['home', 'no gym', 'bodyweight'],                 program: '6wk_home' },
];

// WhatsApp template to send for each program interest (with a checkout link param)
const PROGRAM_TEMPLATES = {
  '6wk_gym':   'program_6wk_gym',
  'pcos':      'program_pcos',
  '40plus':    'program_40plus',
  '12wk':      'program_12wk',
  'zoom_trial':'program_zoom_trial',
  '6wk_home':  'program_6wk_home',
};

const CHECKOUT_LINKS = {
  '6wk_gym':    process.env.CHECKOUT_6WK_GYM    || process.env.CHECKOUT_BASE_URL || '',
  'pcos':       process.env.CHECKOUT_PCOS        || process.env.CHECKOUT_BASE_URL || '',
  '40plus':     process.env.CHECKOUT_40PLUS      || process.env.CHECKOUT_BASE_URL || '',
  '12wk':       process.env.CHECKOUT_12WK        || process.env.CHECKOUT_BASE_URL || '',
  'zoom_trial': process.env.CHECKOUT_ZOOM_TRIAL  || process.env.CHECKOUT_BASE_URL || '',
  '6wk_home':   process.env.CHECKOUT_6WK_HOME    || process.env.CHECKOUT_BASE_URL || '',
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel'];

function isOptOut(message) {
  const lower = (message || '').toLowerCase();
  return OPT_OUT_KEYWORDS.some((kw) => lower.includes(kw));
}

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const { keywords, program } of KEYWORD_PROGRAMS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

module.exports = async function handler(req, res) {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── 1. Parse incoming message ─────────────────────────────────────────
    const body = req.body || {};
    const phone   = (body.phone   || '').trim();
    const message = (body.message || '').trim();
    const name    = (body.name    || '').trim();
    // timestamp comes as string; default to now
    const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const masked = maskPhone(phone);
    console.log(`[webhook] Incoming message from ${masked}`);

    // ── 2. Opt-out check ─────────────────────────────────────────────────
    if (isOptOut(message)) {
      console.log(`[webhook] Opt-out received from ${masked}`);
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);

      // Log the inbound message even for opt-outs
      await supabase.from('messages').insert({
        phone,
        direction: 'in',
        body: message,
        status: 'received',
        metadata: { name, timestamp: timestamp.toISOString(), opt_out: true },
      });

      return res.status(200).json({ success: true, action: 'opted_out' });
    }

    // ── 3. Escalation check ───────────────────────────────────────────────
    const escalationKeyword = needsEscalation(message);
    if (escalationKeyword) {
      console.log(`[webhook] Escalation keyword "${escalationKeyword}" from ${masked}`);
      // Look up client_id if one exists
      const { data: clientRow } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      await createEscalation(
        phone,
        escalationKeyword,
        message,
        clientRow ? clientRow.id : null
      );
    }

    // ── 4. Look up lead ───────────────────────────────────────────────────
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, program_interest, first_msg')
      .eq('phone', phone)
      .maybeSingle();

    // ── 5. New lead ───────────────────────────────────────────────────────
    if (!existingLead) {
      const market = detectMarket(phone);
      console.log(`[webhook] New lead from ${masked}, market=${market}`);

      const { data: newLead, error: insertErr } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          status: 'new',
          first_msg: message || null,
          last_msg_at: timestamp.toISOString(),
          market,
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error(`[webhook] Failed to insert lead for ${masked}:`, insertErr.message);
      }

      // Send welcome template
      await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);

      // Schedule nudge: insert a nudge record (cron will process it)
      if (newLead) {
        await supabase.from('messages').insert({
          phone,
          direction: 'out',
          body: 'nudge_scheduled',
          template_name: 'nudge_scheduled',
          status: 'pending',
          metadata: { lead_id: newLead.id, nudge_type: 'welcome_followup' },
        });
      }
    } else if (existingLead.status === 'new') {
      // ── 6. Qualify existing new lead ─────────────────────────────────────
      const program = detectProgram(message);

      if (program) {
        console.log(`[webhook] Qualifying ${masked} → ${program}`);

        await supabase
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: program,
            last_msg_at: timestamp.toISOString(),
            name: existingLead.name || (name || null),
          })
          .eq('id', existingLead.id);

        const templateName   = PROGRAM_TEMPLATES[program];
        const checkoutLink   = CHECKOUT_LINKS[program];
        const displayName    = name || 'there';
        await sendWhatsApp(phone, templateName, [displayName, checkoutLink]);
      } else {
        // Just update last_msg_at
        await supabase
          .from('leads')
          .update({ last_msg_at: timestamp.toISOString() })
          .eq('id', existingLead.id);
      }
    } else {
      // Existing lead in other status — just update last_msg_at
      await supabase
        .from('leads')
        .update({ last_msg_at: timestamp.toISOString() })
        .eq('phone', phone);
    }

    // ── 7. Log inbound message ────────────────────────────────────────────
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
      metadata: { name, timestamp: timestamp.toISOString() },
    });

    // ── 8. Always 200 ─────────────────────────────────────────────────────
    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[webhook] Unhandled error:', err.message);
    // Still return 200 so AiSensy doesn't retry indefinitely
    return res.status(200).json({ success: false, error: 'internal_error' });
  }
};
