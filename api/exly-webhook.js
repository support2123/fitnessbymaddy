const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
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

    const { customer_phone, customer_name, customer_email, product_name, amount, checkout_id } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const supabase = getSupabase();
    const phone = normalizePhone(customer_phone);
    const program = mapProductToProgram(product_name);
    const now = new Date();
    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseFloat(amount) : null,
        checkout_id: checkout_id || null,
        status: 'active',
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (error) {
      console.error('Client create error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendWhatsApp(phone, `onboard_${program}`, [
      customer_name || 'there',
      programWeeks.toString(),
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.status(200).json({ status: 'converted', client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
