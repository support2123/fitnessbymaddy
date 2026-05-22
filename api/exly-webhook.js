const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone, programWeekCount } = require('../lib/helpers');
const crypto = require('crypto');

const PROGRAM_DURATION_DAYS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 56,
  '40plus': 56,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) {
    console.log('[Exly] No EXLY_WEBHOOK_SECRET configured, skipping verification');
    return true;
  }
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-signature');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-webhook-signature'];

    if (!verifySignature(rawBody, signature)) {
      console.error('[Exly] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { checkout_id, phone, name, email, amount, program_slug } = req.body;

    if (!phone || !program_slug) {
      return res.status(400).json({ error: 'Missing required fields: phone, program_slug' });
    }

    console.log(`[Exly] Purchase received: ${maskPhone(phone)} / ${program_slug} / $${amount}`);

    // Find existing lead by phone
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, name')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      // Update lead status to converted
      await supabase
        .from('leads')
        .update({ status: 'converted', converted_at: new Date().toISOString() })
        .eq('id', lead.id);
      console.log(`[Exly] Lead ${lead.id} marked as converted`);
    } else {
      console.log(`[Exly] No existing lead found for ${maskPhone(phone)}`);
    }

    // Calculate program end date
    const durationDays = PROGRAM_DURATION_DAYS[program_slug] || 42;
    const programStartsAt = new Date();
    const programEndsAt = new Date(programStartsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program: program_slug,
        paid_amount: amount,
        checkout_id,
        status: 'active',
        program_started_at: programStartsAt.toISOString(),
        program_ends_at: programEndsAt.toISOString(),
      })
      .select()
      .single();

    if (clientError) {
      console.error('[Exly] Failed to create client:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    console.log(`[Exly] Client created: ${client.id} (${program_slug}, ends ${programEndsAt.toISOString().slice(0, 10)})`);

    // Send welcome WhatsApp template
    const clientName = name || lead?.name || 'there';
    const templateName = `onboard_${program_slug}`;
    await sendWhatsApp({
      phone,
      templateName,
      params: [clientName],
    });
    console.log(`[Exly] Welcome template "${templateName}" sent to ${maskPhone(phone)}`);

    // For 12-week program, trigger Week 1 program generation
    if (program_slug === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
        console.log(`[Exly] Week 1 program generation triggered for client ${client.id}`);
      } catch (genErr) {
        console.error(`[Exly] Program generation trigger failed:`, genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program: program_slug,
      ends_at: programEndsAt.toISOString(),
    });
  } catch (err) {
    console.error('[Exly] Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
