const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

// ── Program duration mapping (days) ────────────────────────────────
const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

// ── Exly product-name → internal program enum ─────────────────────
const PRODUCT_MAP = {
  '6 week gym shred': '6wk_gym',
  '6 week home workout': '6wk_home',
  '12 week transformation': '12wk',
  'pcos fitness program': 'pcos',
  '40+ fitness program': '40plus',
  'zoom trial session': 'zoom_trial',
  'zoom session pack': 'zoom_pack',
  // Also match on short codes Exly may use
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12wk': '12wk',
  pcos: 'pcos',
  '40plus': '40plus',
  zoom_trial: 'zoom_trial',
  zoom_pack: 'zoom_pack',
};

function mapProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase().trim();
  // Exact match first
  if (PRODUCT_MAP[lower]) return PRODUCT_MAP[lower];
  // Partial match
  for (const [key, val] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // Skip verification if no secret configured
  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
    .digest('hex');

  // Support both plain hex and "sha256=hex" formats
  const provided = signatureHeader.replace(/^sha256=/, '');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Exly-Signature');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── Verify webhook authenticity ──────────────────────────────
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    const signature =
      req.headers['x-exly-signature'] ||
      req.headers['x-webhook-signature'] ||
      '';

    if (secret && !verifySignature(req.body, signature, secret)) {
      console.error('Exly webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ── Extract purchase data ────────────────────────────────────
    const body = req.body || {};
    const buyerPhone = body.phone || body.buyer_phone || body.customer_phone || '';
    const buyerEmail = body.email || body.buyer_email || body.customer_email || '';
    const buyerName = body.name || body.buyer_name || body.customer_name || '';
    const productName = body.product || body.product_name || body.program || '';
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId =
      body.checkout_id || body.order_id || body.transaction_id || '';

    if (!buyerPhone) {
      console.error('Exly webhook missing buyer phone');
      return res.status(400).json({ error: 'Missing buyer phone' });
    }

    const masked = maskPhone(buyerPhone);
    const program = mapProduct(productName);

    if (!program) {
      console.error(
        `Exly webhook: unmapped product "${productName}" for ${masked}`
      );
      return res
        .status(400)
        .json({ error: 'Could not map product to a program' });
    }

    // ── Find or create lead ──────────────────────────────────────
    const now = new Date().toISOString();

    let { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', buyerPhone)
      .maybeSingle();

    if (!lead) {
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          phone: buyerPhone,
          name: buyerName || null,
          email: buyerEmail || null,
          status: 'converted',
          program_interest: program,
          source: 'exly',
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();

      if (leadErr) {
        console.error(`Lead creation failed for ${masked}:`, leadErr.message);
        return res.status(500).json({ error: 'Lead creation failed' });
      }
      lead = newLead;
    } else {
      // Update existing lead to converted
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          program_interest: program,
          updated_at: now,
        })
        .eq('id', lead.id);
    }

    // ── Calculate program dates ──────────────────────────────────
    const startDate = new Date();
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // ── Insert into clients table ────────────────────────────────
    const { error: clientErr } = await supabase.from('clients').upsert(
      {
        lead_id: lead.id,
        phone: buyerPhone,
        name: buyerName || null,
        email: buyerEmail || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id: checkoutId,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'phone' }
    );

    if (clientErr) {
      console.error(`Client insert failed for ${masked}:`, clientErr.message);
      return res.status(500).json({ error: 'Client record creation failed' });
    }

    // ── Create Supabase Storage folder path for client ───────────
    const folderPath = `clients/${buyerPhone}/`;
    const placeholderContent = Buffer.from('');
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}.keep`, placeholderContent, {
        upsert: true,
        contentType: 'application/octet-stream',
      })
      .catch((err) => {
        console.warn(`Storage folder creation for ${masked}:`, err.message);
      });

    // ── Send onboarding WhatsApp template ────────────────────────
    const onboardTemplate = `onboard_${program}`;
    await sendTemplate(buyerPhone, onboardTemplate, {
      userName: buyerName || buyerPhone,
      templateParams: [buyerName || 'there'],
    });

    // ── If 12-week program, trigger week-1 program generation ────
    if (program === '12wk') {
      try {
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : process.env.BASE_URL || 'http://localhost:3000';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            phone: buyerPhone,
            program: '12wk',
            week: 1,
          }),
        });
      } catch (genErr) {
        // Non-blocking — program generation can be retried
        console.error(
          `Program generation trigger failed for ${masked}:`,
          genErr.message
        );
      }
    }

    console.log(`Purchase processed: ${masked} → ${program}`);
    return res.status(200).json({ status: 'ok', program });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(200).json({ status: 'error' });
  }
};
