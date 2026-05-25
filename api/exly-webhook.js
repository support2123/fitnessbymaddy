const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

/**
 * Verify Exly webhook signature.
 * Compares HMAC-SHA256 of raw body against the x-exly-signature header.
 */
function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signatureHeader, 'hex')
  );
}

/**
 * Map a product name string to an internal program type.
 */
function mapProductToProgram(productName, metadata) {
  const name = (productName || '').toLowerCase();

  if (metadata && metadata.program_type) return metadata.program_type;

  if (name.includes('12') && name.includes('week')) return '12wk';
  if (name.includes('6') && name.includes('week')) return '6wk_gym';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('menopause')) return '40plus';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';

  return '6wk_gym'; // default fallback
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* ── Verify webhook authenticity ── */
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    const signature = req.headers['x-exly-signature'] || '';

    if (!verifySignature(req.body, signature, secret)) {
      console.error('exly-webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const supabase = getSupabase();
    const payload = req.body || {};

    /* ── Extract purchase details ── */
    const phone = (payload.customer_phone || payload.phone || '').replace(/\s+/g, '');
    const email = payload.customer_email || payload.email || '';
    const name = payload.customer_name || payload.name || '';
    const amount = parseFloat(payload.amount) || 0;
    const checkoutId = payload.checkout_id || payload.order_id || '';
    const productName = payload.product_name || payload.product || '';
    const metadata = payload.metadata || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const programType = mapProductToProgram(productName, metadata);
    const now = new Date().toISOString();

    /* ── Calculate program end date ── */
    const durationWeeks = programType === '12wk' ? 12 : programType.includes('6wk') ? 6 : 6;
    const endsAt = new Date(
      Date.now() + durationWeeks * 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    /* ── Insert into clients table (link to existing lead by phone) ── */
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        phone,
        email,
        name,
        amount_paid: amount,
        checkout_id: checkoutId,
        product_name: productName,
        program_type: programType,
        status: 'active',
        program_started_at: now,
        program_ends_at: endsAt,
        created_at: now,
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error(`exly-webhook client insert error [${maskPhone(phone)}]:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const clientId = client.id;

    /* ── Update lead status to converted ── */
    await supabase
      .from('leads')
      .update({
        status: 'converted',
        client_id: clientId,
        updated_at: now,
      })
      .eq('phone', phone);

    /* ── Create Supabase Storage folder path (upload a placeholder) ── */
    await supabase.storage
      .from('uploads')
      .upload(`clients/${clientId}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true,
      });

    /* ── Send onboarding WhatsApp template ── */
    await sendWhatsApp(phone, 'onboarding_v1', {
      name,
      program: programType,
      intake_url: `https://fitnessbymaddy.com/intake.html?ph=${encodeURIComponent(phone)}`,
    });

    /* ── If 12wk program, trigger immediate Week 1 program generation ── */
    if (programType === '12wk') {
      const baseUrl =
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret': process.env.API_SECRET || '',
          },
          body: JSON.stringify({
            client_id: clientId,
            week_no: 1,
          }),
        });
      } catch (genErr) {
        console.error(
          `exly-webhook: Week 1 generation trigger failed [client:${clientId}]:`,
          genErr.message
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    const safePhone = maskPhone((req.body || {}).customer_phone || '');
    console.error(`exly-webhook error [${safePhone}]:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
