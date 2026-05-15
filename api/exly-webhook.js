const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, status: paymentStatus
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (paymentStatus === 'failed') {
      await notifyMaddy(
        'Payment failed',
        `Phone: ${maskPhone(phone)}\nName: ${name}\nAmount: ${amount}`
      );
      return res.status(200).json({ action: 'payment_failed_notified' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = mapExlyProduct(product_name, lead?.program_interest);
    const programDays = program === '12wk' ? 84 : 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    try {
      await db.storage.from('clients').upload(
        `${client.id}/.keep`,
        new Uint8Array(0),
        { contentType: 'application/octet-stream' }
      );
      await db.from('clients')
        .update({ folder_url: `/clients/${client.id}/` })
        .eq('id', client.id);
    } catch (e) {
      console.error('Storage folder creation failed:', e.message);
    }

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=1`
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName, leadInterest) {
  if (!productName) return leadInterest || '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return leadInterest || '6wk_gym';
}
