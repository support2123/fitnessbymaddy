const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');
const { PROGRAMS } = require('./_lib/constants');

/**
 * Verify Exly webhook signature.
 * @param {object} req - Vercel request object
 * @returns {boolean}
 */
function verifySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[exly-webhook] EXLY_WEBHOOK_SECRET not set — skipping verification');
    return true;
  }

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  if (!signature) return false;

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

/**
 * Resolve the program key from a checkout/product ID.
 * @param {string} checkoutId
 * @param {string} productName
 * @returns {string} program key from PROGRAMS
 */
function resolveProgram(checkoutId, productName) {
  // Try direct match on checkout ID
  if (checkoutId && PROGRAMS[checkoutId]) return checkoutId;

  // Try matching product name against program names
  if (productName) {
    const lower = productName.toLowerCase();
    for (const [key, prog] of Object.entries(PROGRAMS)) {
      if (lower.includes(prog.name.toLowerCase()) || lower.includes(key.replace('_', ' '))) {
        return key;
      }
    }
  }

  return null;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Exly-Signature, X-Webhook-Signature');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    if (!verifySignature(req)) {
      console.warn('[exly-webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = req.body || {};

    // Extract customer info — adapt to Exly's payload shape
    const phone = body.customer_phone || body.phone || body.customer?.phone || '';
    const email = body.customer_email || body.email || body.customer?.email || '';
    const name = body.customer_name || body.name || body.customer?.name || '';
    const checkoutId = body.checkout_id || body.product_id || '';
    const productName = body.product_name || body.checkout_name || '';
    const amount = body.amount || body.total || 0;

    if (!phone) {
      console.warn('[exly-webhook] No phone in purchase payload');
      return res.status(200).json({ ok: true, note: 'no phone' });
    }

    console.log(`[exly-webhook] Purchase from ${maskPhone(phone)}, product=${checkoutId || productName}`);

    // Resolve program
    const programKey = resolveProgram(checkoutId, productName);
    const program = programKey ? PROGRAMS[programKey] : null;
    const duration = program ? program.duration : 42; // default 6 weeks

    const now = new Date();
    const programEndsAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000).toISOString();
    const firstCheckinDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find matching lead
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    // Insert client record
    const storagePath = `clients/${phone.replace(/\D/g, '')}`;

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        phone,
        email: email || null,
        name: name || null,
        lead_id: lead ? lead.id : null,
        program: programKey || '6wk_gym',
        status: 'active',
        paid_amount: amount,
        checkout_id: checkoutId || null,
        program_started_at: now.toISOString(),
        program_ends_at: programEndsAt,
        folder_url: storagePath,
      })
      .select()
      .single();

    if (clientErr) {
      console.error('[exly-webhook] Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    console.log(`[exly-webhook] Client created: ${client.id}, program=${programKey}`);

    // Update lead status to converted
    if (lead) {
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          updated_at: now.toISOString(),
        })
        .eq('id', lead.id);
    }

    // Send onboarding WhatsApp template
    await sendTemplate(phone, 'onboarding_welcome', {
      name: name || 'there',
      program: program ? program.name : 'your program',
    });

    // If 12-week program, flag for immediate program generation
    if (programKey === '12wk') {
      console.log(`[exly-webhook] 12wk program — flagged for generation, client ${client.id}`);
      // The needs_program_generation flag is already set in the insert above.
      // A cron job or background worker will pick this up.
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[exly-webhook] Unhandled error:', err.message);
    return res.status(200).json({ ok: false, error: 'internal' });
  }
};
