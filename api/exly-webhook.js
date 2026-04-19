const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return signature === expected;
}

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const {
      customer_name,
      customer_email,
      customer_phone,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status && status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not a completed payment' });
    }

    const phone = customer_phone || '';
    const program = mapExlyProduct(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('checkout_id', checkout_id)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'duplicate', client_id: existingClient.id });
    }

    const { data: client, error } = await supabase
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
        folder_url: `/clients/${phone}/`,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      durationDays.toString(),
    ]);

    if (program === '12wk') {
      const origin = req.headers['x-forwarded-proto']
        ? `${req.headers['x-forwarded-proto']}://${req.headers['host']}`
        : `https://${req.headers['host']}`;

      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) => {
        console.error('Week-1 program generation trigger failed:', err.message);
      });
    }

    console.log(`Converted: ${maskPhone(phone)} → ${program}`);

    return res.status(200).json({ action: 'converted', client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
