import crypto from 'node:crypto';
import { createClient } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { parseBody, cors, maskPhone } from '../lib/helpers.js';

/* ── Program mapping ─────────────────────────────────────────────── */

const PRODUCT_PATTERNS = [
  { test: /6\s*week|shred|burn/i, code: '6wk_gym' },
  { test: /pcos/i, code: 'pcos' },
  { test: /40\+|40\s*plus/i, code: '40plus' },
  { test: /12\s*week|custom|flagship/i, code: '12wk' },
  { test: /trial|zoom/i, code: 'zoom_trial' },
];

function mapProduct(name) {
  if (!name) return '6wk_gym';
  for (const { test, code } of PRODUCT_PATTERNS) {
    if (test.test(name)) return code;
  }
  return '6wk_gym';
}

/* ── Program duration (days) ─────────────────────────────────────── */

const DURATION_DAYS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  pcos: 42,
  '40plus': 42,
  '12wk': 84,
  zoom_trial: 7,
  zoom_pack: 30,
};

function programEndsAt(program) {
  const days = DURATION_DAYS[program] ?? 42;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/* ── Signature verification ──────────────────────────────────────── */

function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured — skip in dev
  if (!signatureHeader) return true; // no header sent — skip (dev mode)

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf-8'),
    Buffer.from(signatureHeader, 'utf-8'),
  );
}

/* ── Handler ─────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (cors(res)) return; // handle OPTIONS preflight

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  let rawBody;

  try {
    // We need the raw body string for HMAC verification *and* the parsed object.
    if (req.body && typeof req.body === 'object') {
      body = req.body;
      rawBody = JSON.stringify(body);
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      rawBody = Buffer.concat(chunks).toString('utf-8');
      body = rawBody ? JSON.parse(rawBody) : {};
    }
  } catch (err) {
    console.error('exly-webhook: failed to parse body', err.message);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  /* ── Signature check ───────────────────────────────────────────── */
  const signature = req.headers['x-exly-signature'];
  if (!verifySignature(rawBody, signature)) {
    console.error('exly-webhook: invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  /* ── Status gate ───────────────────────────────────────────────── */
  const status = (body.status || '').toLowerCase();
  if (status !== 'success' && status !== 'completed') {
    return res.status(200).json({ skipped: true, reason: `status=${body.status}` });
  }

  const phone = body.customer_phone;
  const name = body.customer_name || '';
  const email = body.customer_email || '';
  const productName = body.product_name || '';
  const amount = body.amount ?? 0;
  const transactionId = body.transaction_id || null;

  if (!phone) {
    return res.status(400).json({ error: 'Missing customer_phone' });
  }

  const program = mapProduct(productName);
  const supabase = createClient();

  try {
    /* ── Look up existing lead ───────────────────────────────────── */
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    const leadId = lead?.id || null;

    /* ── Insert client record ────────────────────────────────────── */
    const { data: client, error: insertErr } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        paid_amount: amount,
        checkout_id: transactionId,
        program_ends_at: programEndsAt(program),
        status: 'active',
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('exly-webhook: insert client failed', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    const clientId = client.id;
    console.log(
      `exly-webhook: created client ${clientId} (${program}) for ${maskPhone(phone)}`,
    );

    /* ── Update lead status ──────────────────────────────────────── */
    if (leadId) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    /* ── Storage folder placeholder ──────────────────────────────── */
    try {
      await supabase.storage
        .from('clients')
        .upload(`${clientId}/.keep`, Buffer.from(''), {
          contentType: 'text/plain',
          upsert: true,
        });
    } catch (storageErr) {
      // Non-critical — log and continue
      console.error(
        'exly-webhook: storage placeholder failed',
        storageErr.message,
      );
    }

    /* ── Onboarding WhatsApp ─────────────────────────────────────── */
    try {
      await sendTemplate(phone, `onboard_${program}`, [name]);
    } catch (waErr) {
      console.error('exly-webhook: onboarding WA failed', waErr.message);
    }

    /* ── Auto-generate week-1 for 12wk program ──────────────────── */
    if (program === '12wk') {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        // Non-critical — coach can trigger manually
        console.error(
          'exly-webhook: generate-program call failed',
          genErr.message,
        );
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('exly-webhook: unexpected error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
