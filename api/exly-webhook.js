const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { getProgramDetails } = require('../lib/utils');

const ALLOWED_ORIGIN = 'https://fitnessbymaddy.com';

// Map Exly product names to internal program keys
const PRODUCT_MAP = {
  '6-week gym transformation': '6wk_gym',
  '6-week home workout plan': '6wk_home',
  '6 week shred': '6wk_gym',
  '6 week home': '6wk_home',
  'pcos wellness program': 'pcos',
  'pcos': 'pcos',
  '40+ fitness program': '40plus',
  '40 plus': '40plus',
  '12-week advanced transformation': '12wk',
  '12 week custom': '12wk',
  '12 week program': '12wk',
  'zoom trial session': 'zoom_trial',
  'zoom trial': 'zoom_trial',
  '1-on-1 coaching': 'zoom_trial'
};

// Program durations in days
const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  pcos: 56,
  '40plus': 56,
  '12wk': 84,
  zoom_trial: 1
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase().trim();

  // Exact match first
  if (PRODUCT_MAP[lower]) return PRODUCT_MAP[lower];

  // Partial match
  for (const [key, value] of Object.entries(PRODUCT_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return value;
  }

  return null;
}

function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('EXLY_WEBHOOK_SECRET not configured');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature || '', 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Exly-Signature');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    const signature = req.headers['x-exly-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature)) {
      console.error('Exly webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      customer_name,
      customer_email,
      customer_phone,
      product_name,
      amount,
      checkout_id
    } = body;

    if (!customer_phone || !product_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const programKey = mapProductToProgram(product_name);
    if (!programKey) {
      console.error(`Unknown product: ${product_name}`);
      return res.status(400).json({ error: 'Unknown product' });
    }

    const programDetails = getProgramDetails(programKey);
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Look up existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    let leadId;

    if (existingLead) {
      // Update lead to converted
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          name: customer_name || existingLead.name,
          program_interest: programKey,
          last_msg_at: now.toISOString()
        })
        .eq('id', existingLead.id);

      leadId = existingLead.id;
    } else {
      // Create new lead directly as converted
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          phone: customer_phone,
          name: customer_name || null,
          status: 'converted',
          source: 'exly',
          program_interest: programKey,
          created_at: now.toISOString()
        })
        .select()
        .single();

      if (leadErr) {
        console.error(`Failed to create lead for ${maskPhone(customer_phone)}:`, leadErr.message);
        return res.status(500).json({ error: 'Internal server error' });
      }

      leadId = newLead.id;
    }

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: customer_phone,
        name: customer_name || null,
        email: customer_email || null,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        status: 'active',
        created_at: now.toISOString()
      })
      .select()
      .single();

    if (clientErr) {
      console.error(`Failed to create client for ${maskPhone(customer_phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Send onboarding WhatsApp template
    await sendTemplate(customer_phone, `onboard_${programKey}`, [
      customer_name || 'there',
      programDetails ? programDetails.name : product_name,
      programDetails ? programDetails.duration : `${durationDays} days`
    ]);

    // If 12-week program, log intent to generate program
    if (programKey === '12wk') {
      console.log(
        `[GENERATE-PROGRAM] Intent logged for client ${client.id}, ` +
        `lead ${leadId}, phone ${maskPhone(customer_phone)}. ` +
        `Would call /api/generate-program with clientId=${client.id}`
      );
    }

    console.log(
      `Exly purchase processed: ${maskPhone(customer_phone)} → ${programKey}, ` +
      `checkout ${checkout_id}`
    );

    return res.status(200).json({
      status: 'ok',
      client_id: client.id,
      program: programKey
    });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
