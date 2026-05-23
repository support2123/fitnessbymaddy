'use strict';

// POST /api/exly-webhook
// Handles Exly purchase confirmation webhooks.
// Converts a lead to a client upon successful payment.

const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Exly-Signature',
};

// ─── Program duration in weeks ─────────────────────────────────────────────
const PROGRAM_WEEKS = {
  '6wk_gym':    6,
  'pcos':       6,
  '40plus':     6,
  '6wk_home':   6,
  'zoom_trial': 1,
  '12wk':      12,
};

// ─── Map product_name → program enum ──────────────────────────────────────
function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();

  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('forty')) return '40plus';
  if (lower.includes('12 week') || lower.includes('12week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6 week') || lower.includes('6week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';

  return '6wk_gym'; // default
}

// ─── Simple HMAC-SHA256 signature check ────────────────────────────────────
async function verifySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // No secret configured → skip check

  const signature = req.headers['x-exly-signature'] || '';
  if (!signature) return false;

  // Signature is expected as hex-encoded HMAC-SHA256 of the raw body
  const rawBody = typeof req.body === 'string'
    ? req.body
    : JSON.stringify(req.body);

  const { createHmac } = require('crypto');
  const expected = createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  return signature === expected;
}

module.exports = async function handler(req, res) {
  // ── CORS preflight ──────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Signature verification ──────────────────────────────────────────
    const signatureOk = await verifySignature(req);
    if (!signatureOk) {
      console.warn('[exly-webhook] Invalid signature — rejecting request');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = req.body || {};

    const {
      checkout_id,
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      status,
    } = body;

    // Only process successful payments
    if (status && status.toLowerCase() !== 'success' && status.toLowerCase() !== 'paid') {
      console.log(`[exly-webhook] Ignoring non-success status: ${status}`);
      return res.status(200).json({ success: true, action: 'ignored', reason: 'non_success_status' });
    }

    const phone  = (customer_phone || '').trim();
    const name   = (customer_name  || '').trim() || null;
    const email  = (customer_email || '').trim() || null;
    const masked = phone ? maskPhone(phone) : 'unknown';

    console.log(`[exly-webhook] Purchase confirmed: ${masked}, product="${product_name}", checkout_id=${checkout_id}`);

    // ── 1. Find lead by phone ───────────────────────────────────────────
    let leadId = null;
    if (phone) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (lead) leadId = lead.id;
    }

    // ── 2. Map product → program ────────────────────────────────────────
    const program = mapProductToProgram(product_name);
    console.log(`[exly-webhook] Mapped "${product_name}" → program=${program} for ${masked}`);

    // ── 3. Calculate program_ends_at ────────────────────────────────────
    const weeks = PROGRAM_WEEKS[program] || 6;
    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + weeks * 7);

    // ── 4. Insert or update client record ──────────────────────────────
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    let clientId = null;

    const clientData = {
      phone,
      name: name || undefined,
      email: email || undefined,
      program,
      status: 'active',
      lead_id: leadId || undefined,
      checkout_id: checkout_id || undefined,
      paid_amount: amount != null ? Math.round(parseFloat(amount) * 100) : undefined,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt.toISOString(),
    };

    if (existingClient) {
      const { data: updated, error: updateErr } = await supabase
        .from('clients')
        .update(clientData)
        .eq('id', existingClient.id)
        .select('id')
        .single();

      if (updateErr) {
        console.error(`[exly-webhook] Failed to update client for ${masked}:`, updateErr.message);
      } else {
        clientId = updated.id;
        console.log(`[exly-webhook] Updated existing client ${clientId} for ${masked}`);
      }
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('clients')
        .insert(clientData)
        .select('id')
        .single();

      if (insertErr) {
        console.error(`[exly-webhook] Failed to insert client for ${masked}:`, insertErr.message);
      } else {
        clientId = inserted.id;
        console.log(`[exly-webhook] Created new client ${clientId} for ${masked}`);
      }
    }

    // ── 5. Update lead status to 'converted' ───────────────────────────
    if (leadId) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    } else if (phone) {
      // Attempt phone-based update even without a known leadId
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('phone', phone);
    }

    // ── 6. Send onboarding WhatsApp template ───────────────────────────
    if (phone) {
      const onboardTemplate = `onboard_${program}`;
      console.log(`[exly-webhook] Sending onboarding template "${onboardTemplate}" to ${masked}`);

      await sendWhatsApp(
        phone,
        onboardTemplate,
        [name || 'there'],
        true // isClient — bypass rate limit
      );
    }

    // ── 7. For 12wk program → trigger Week 1 generation ────────────────
    if (program === '12wk' && clientId) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.APP_URL || 'http://localhost:3000';

      // Fire-and-forget: non-blocking
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET || ''}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      }).catch((err) => {
        console.error('[exly-webhook] generate-program trigger failed:', err.message);
      });

      console.log(`[exly-webhook] Week 1 program generation triggered for client ${clientId}`);
    }

    // ── 8. Return 200 ──────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      client_id: clientId,
      program,
      program_ends_at: programEndsAt.toISOString(),
    });

  } catch (err) {
    console.error('[exly-webhook] Unhandled error:', err.message);
    return res.status(500).json({ success: false, error: 'internal_error' });
  }
};
