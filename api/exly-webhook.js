const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { createEscalation } = require('../lib/escalation');
const { cors, parseBody, programLabel, weeksBetween } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const {
    checkout_id, customer_phone, customer_name, customer_email,
    product_name, amount, status,
  } = body;

  if (status === 'failed') {
    const db = getSupabase();
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('phone', customer_phone)
      .eq('status', 'active')
      .maybeSingle();

    if (client) {
      await createEscalation(
        customer_phone,
        'payment_failure',
        `Payment failed for active client: ${product_name}`
      );
    }
    return res.status(200).json({ action: 'payment_failed_logged' });
  }

  if (status !== 'success' && status !== 'completed') {
    return res.status(200).json({ action: 'ignored_status', status });
  }

  const db = getSupabase();
  const phone = customer_phone;
  const program = mapExlyProduct(product_name);
  const programWeeks = program === '12wk' ? 12 : 6;
  const now = new Date();
  const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (lead) {
    await db
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('checkout_id', checkout_id)
    .maybeSingle();

  if (existingClient) {
    return res.status(200).json({ action: 'duplicate_webhook' });
  }

  const { data: client, error } = await db
    .from('clients')
    .insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    console.error('Client creation error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const templateName = `onboard_${program}`;
  await sendWhatsApp(phone, templateName, [
    customer_name || 'there',
    programLabel(program),
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week-1 program generation failed:', err.message);
    }
  }

  return res.status(200).json({ action: 'converted', client_id: client.id });
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship'))
    return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
