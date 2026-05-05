const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { email, phone, name, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getSupabase();

    const program = mapExlyProduct(product_name);
    const weeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      status: 'active',
      folder_url: `/clients/${lead?.id || 'new'}/`,
    }, { onConflict: 'phone' }).select().single();

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there', program === '12wk' ? '12-Week Custom' : '6-Week'],
    });

    if (program === '12wk' && client) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
