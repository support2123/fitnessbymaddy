// api/exly-webhook.js — Exly purchase webhook handler

const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Map Exly product names to internal program enum values.
 */
function mapProductToProgram(productName) {
  if (!productName) return null;
  const name = productName.toLowerCase();

  if (name.includes('12 week') || name.includes('12-week') || name.includes('flagship')) {
    return '12wk';
  }
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus') || name.includes('forty')) return '40plus';
  if (name.includes('zoom pack') || name.includes('zoom-pack')) return 'zoom_pack';
  if (name.includes('trial') || name.includes('zoom trial')) return 'zoom_trial';
  if (name.includes('home') || name.includes('bodyweight')) return '6wk_home';
  if (name.includes('6 week') || name.includes('6-week') || name.includes('shred') || name.includes('burn')) {
    return '6wk_gym';
  }

  return null;
}

/**
 * Calculate program end date based on program type.
 */
function calculateProgramEnd(program, startDate) {
  const start = new Date(startDate);
  const weeksMap = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    'pcos': 8,
    '40plus': 8,
    'zoom_trial': 4,
    'zoom_pack': 8,
  };
  const weeks = weeksMap[program] || 6;
  start.setDate(start.getDate() + weeks * 7);
  return start.toISOString();
}

/**
 * Verify Exly webhook signature using HMAC SHA256.
 */
function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[exly] EXLY_WEBHOOK_SECRET not configured — skipping signature check');
    return true;
  }
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Verify webhook signature ────────────────────────────────────
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';

    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(rawBody, signature)) {
      console.error('[exly] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // ── Parse payload ───────────────────────────────────────────────
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
    } = body || {};

    if (!customer_phone || !product_name) {
      console.log('[exly] Missing required fields in payload');
      return res.status(400).json({ error: 'customer_phone and product_name are required' });
    }

    const masked = maskPhone(customer_phone);
    console.log(`[exly] Purchase received: ${masked} — ${product_name} ($${amount || '?'})`);

    // ── Map product to program ──────────────────────────────────────
    const program = mapProductToProgram(product_name);
    if (!program) {
      console.error(`[exly] Unknown product: ${product_name}`);
      return res.status(400).json({ error: 'Unknown product name' });
    }

    const now = new Date().toISOString();
    const programEndsAt = calculateProgramEnd(program, now);

    // ── Look up or create lead ──────────────────────────────────────
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .limit(1)
      .single();

    if (lead) {
      // Update lead status to converted
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          name: customer_name || lead.name,
          program_interest: program,
          last_msg_at: now,
        })
        .eq('id', lead.id);
    } else {
      // Create lead record for direct purchasers
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: customer_phone,
          name: customer_name || null,
          source: 'exly',
          status: 'converted',
          program_interest: program,
          last_msg_at: now,
        })
        .select()
        .single();

      lead = newLead;
    }

    // ── Insert client record ────────────────────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone: customer_phone,
        name: customer_name || null,
        email: customer_email || null,
        program,
        program_started_at: now,
        program_ends_at: programEndsAt,
        paid_amount: amount ? Math.round(Number(amount)) : null,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error(`[exly] Client insert failed for ${masked}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    console.log(`[exly] Client created: ${client.id} (${program})`);

    // ── Create Supabase Storage folder path ─────────────────────────
    // Supabase Storage doesn't need explicit folder creation;
    // folders are created implicitly on first upload.
    // We store the folder path for reference.
    const folderPath = `clients/${client.id}/`;
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    // ── Send onboarding WhatsApp ────────────────────────────────────
    const programNames = {
      '6wk_gym': '6-Week Gym Shred',
      '6wk_home': '6-Week Home Program',
      '12wk': '12-Week Custom Flagship',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      'zoom_trial': 'Zoom Trial Session',
      'zoom_pack': 'Zoom Session Pack',
    };

    const friendlyName = programNames[program] || product_name;

    await sendTemplate(customer_phone, 'onboarding_welcome', [
      customer_name || 'there',
      friendlyName,
    ]);

    await sendText(
      customer_phone,
      `Welcome aboard, ${customer_name || 'there'}! You're enrolled in the ${friendlyName}. ` +
      `Your program runs until ${new Date(programEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. ` +
      `We'll send your first weekly plan shortly!`
    );

    // ── Extra message for 12-week program ───────────────────────────
    if (program === '12wk') {
      await sendText(
        customer_phone,
        'As a 12-Week Flagship client, you get a fully customised program updated every week based on your check-ins. ' +
        'Your first program will be delivered within 24 hours. Get ready!'
      );
    }

    // ── Log the purchase as a message record ────────────────────────
    await supabase.from('messages').insert({
      phone: customer_phone,
      direction: 'in',
      body: JSON.stringify({ event: 'purchase', product_name, amount, checkout_id }),
      template_name: 'exly_purchase',
      sent_at: now,
      status: 'received',
    });

    console.log(`[exly] Onboarding complete for client ${client.id}`);

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('[exly] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
