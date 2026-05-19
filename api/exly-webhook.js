const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  pcos: 42, '40plus': 42, zoom_trial: 7, zoom_pack: 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const { phone, email, name, product, amount, checkout_id, status } = parseExlyPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    if (status === 'failed') {
      const { data: existingClient } = await supabase
        .from('clients').select('id').eq('phone', phone).eq('status', 'active').single();
      if (existingClient) {
        await escalateToMaddy('Payment failure', `Active client ${maskPhone(phone)} payment failed`);
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    const program = mapProduct(product);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads').select('id').eq('phone', phone).single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${phone.replace(/[^0-9]/g, '')}`;

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }, { onConflict: 'phone' }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=1`,
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';
      await fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.customer_phone || body.data?.phone || '',
    email: body.email || body.customer_email || body.data?.email || '',
    name: body.name || body.customer_name || body.data?.name || '',
    product: body.product || body.product_name || body.data?.product || '',
    amount: body.amount || body.total_amount || body.data?.amount || 0,
    checkout_id: body.checkout_id || body.order_id || body.data?.checkout_id || '',
    status: body.status || body.payment_status || 'success',
  };
}

function mapProduct(product) {
  if (!product) return 'zoom_trial';
  const lower = product.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return 'zoom_trial';
}
