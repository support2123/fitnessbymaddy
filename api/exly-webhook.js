const crypto = require('crypto');
const { getClient } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { normalizePhone, maskPhone, jsonResponse, PROGRAM_INFO } = require('./_lib/helpers');

/* ── Product-name / amount → program key mapping ── */

function detectProgram(productName, amount) {
  const name = (productName || '').toLowerCase();

  if (amount <= 2000 || /trial|zoom/.test(name))                   return 'zoom_trial';
  if (amount <= 4500 || /pcos/.test(name))                         return 'pcos';
  if (amount <= 5000 || /40/.test(name))                            return '40plus';
  if (amount <= 9700 || /shred|6\s*week/.test(name))                return '6wk_gym';
  if (amount <= 20000 || /12|custom|flagship/.test(name))           return '12wk';

  return '12wk'; // default
}

/* ── Program duration in days ── */

const DURATION_DAYS = {
  zoom_trial: 7,
  pcos: 42,
  '40plus': 42,
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84
};

/* ── HMAC signature verification ── */

function verifySignature(rawBody, secret, providedSig) {
  if (!providedSig || !secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(providedSig, 'utf8')
    );
  } catch {
    return false; // length mismatch → invalid
  }
}

/* ── Handler ── */

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return jsonResponse(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let phone;

  try {
    /* 1. Verify webhook signature */
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature =
      req.headers['x-exly-signature'] ||
      (req.body && req.body.signature);

    if (!verifySignature(rawBody, process.env.EXLY_WEBHOOK_SECRET, signature)) {
      console.error('[exly-webhook] Invalid signature');
      return jsonResponse(res, 401, { error: 'Invalid signature' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    /* 2. Only process successful payments */
    if (payload.event !== 'payment.success') {
      return jsonResponse(res, 200, { ok: true, skipped: true, reason: 'event not payment.success' });
    }

    const { customer = {}, product = {}, checkout_id } = payload;

    /* 3. Normalize phone */
    phone = normalizePhone(customer.phone || '');
    const name = customer.name || null;
    const email = customer.email || null;

    /* 4. Detect program */
    const program = detectProgram(product.name, product.amount);
    const durationDays = DURATION_DAYS[program] || 42;

    const now = new Date();
    const programEndsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    /* 5. Look up existing lead */
    const db = getClient();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    const leadId = lead ? lead.id : null;

    /* 6. Insert into clients */
    const { data: client, error: insertErr } = await db
      .from('clients')
      .insert({
        phone,
        name,
        email,
        program,
        paid_amount: product.amount,
        checkout_id,
        lead_id: leadId,
        status: 'active',
        program_started_at: now.toISOString(),
        program_ends_at: programEndsAt.toISOString()
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[exly-webhook] Insert failed:', insertErr.message, maskPhone(phone));
      return jsonResponse(res, 500, { error: 'Failed to create client record' });
    }

    const clientId = client.id;

    /* 7. Mark lead as converted */
    if (leadId) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    /* 8. Send welcome WhatsApp template */
    const templateName = 'onboard_' + program;
    await sendTemplate(phone, templateName, [name || 'there']);

    /* 9. For 12-week program, trigger first week generation */
    if (program === '12wk') {
      try {
        const host = req.headers.host || 'www.fitnessbymaddy.com';
        const protocol = host.includes('localhost') ? 'http' : 'https';

        await fetch(`${protocol}://${host}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        // Non-blocking — log but don't fail the webhook
        console.error('[exly-webhook] generate-program call failed:', genErr.message, maskPhone(phone));
      }
    }

    console.log('[exly-webhook] New client created:', clientId, program, maskPhone(phone));

    return jsonResponse(res, 200, { ok: true, client_id: clientId });
  } catch (err) {
    console.error('[exly-webhook] Unhandled error:', err.message, phone ? maskPhone(phone) : 'no-phone');

    // Best-effort notification to Maddy
    try {
      await notifyMaddy('Exly webhook error', err.message);
    } catch (_) { /* swallow */ }

    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
};
