const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');

// Product name → program enum mapping
const PRODUCT_MAP = [
  { pattern: /6\s*week|burn/i, program: '6wk_gym' },
  { pattern: /home/i, program: '6wk_home' },
  { pattern: /12\s*week|custom|flagship/i, program: '12wk' },
  { pattern: /pcos/i, program: 'pcos' },
  { pattern: /40\+|40\s*plus/i, program: '40plus' },
  { pattern: /zoom\s*pack/i, program: 'zoom_pack' },
  { pattern: /trial|zoom\s*trial/i, program: 'zoom_trial' },
];

// Program duration in days
const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

function mapProduct(productName) {
  if (!productName) return null;
  for (const entry of PRODUCT_MAP) {
    if (entry.pattern.test(productName)) {
      return entry.program;
    }
  }
  return null;
}

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature if secret is configured
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      console.warn('[exly] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      checkout_id,
      customer_name,
      customer_phone,
      customer_email,
      product_name,
      amount,
    } = req.body || {};

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    console.log(`[exly] Purchase received: ${maskPhone(customer_phone)}, product="${product_name}", amount=${amount}`);

    // Map product to program
    const program = mapProduct(product_name);
    if (!program) {
      console.error(`[exly] Unknown product: "${product_name}" — cannot map to program`);
      return res.status(400).json({ error: 'Unknown product name' });
    }

    // Find lead by phone
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    const leadId = lead ? lead.id : null;

    // If no lead exists, create one
    if (!lead) {
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          phone: customer_phone,
          name: customer_name || null,
          status: 'converted',
          source: 'exly',
          program_interest: program,
        })
        .select('id')
        .single();

      if (leadErr) {
        console.error(`[exly] Failed to create lead for ${maskPhone(customer_phone)}:`, leadErr.message);
      }
    }

    // Calculate program end date
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + durationDays);

    // Insert into clients table
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : (leadId || null),
        phone: customer_phone,
        name: customer_name || (lead && lead.name) || null,
        email: customer_email || null,
        program,
        program_ends_at: programEndsAt.toISOString(),
        paid_amount: amount ? Math.round(Number(amount)) : null,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error(`[exly] Failed to create client for ${maskPhone(customer_phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    // Update lead status to converted
    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    console.log(`[exly] Client created: ${client.id}, program=${program}, ends=${programEndsAt.toISOString()}`);

    // Send onboarding WhatsApp template
    const templateName = `onboard_${program}`;
    await sendTemplate(customer_phone, templateName, [customer_name || 'there']);

    // If 12wk program, trigger Week 1 program generation
    if (program === '12wk' && client.id) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.BASE_URL || 'http://localhost:3000';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
          }),
        });

        console.log(`[exly] Triggered Week 1 program generation for client ${client.id}`);
      } catch (genErr) {
        console.error(`[exly] Failed to trigger program generation:`, genErr.message);
        // Non-fatal — coach can generate manually
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('[exly] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
