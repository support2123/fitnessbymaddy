const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { getProgramWeeks, detectMarket, isHinglishMarket, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const {
    customer_phone,
    customer_name,
    customer_email,
    product_name,
    amount,
    checkout_id,
    lead_id,
  } = req.body;

  const phone = customer_phone;
  if (!phone) return res.status(400).json({ error: 'customer_phone required' });

  let lead;
  if (lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle();
    lead = data;
  }
  if (!lead) {
    const { data } = await supabase.from('leads').select('*').eq('phone', phone).maybeSingle();
    lead = data;
  }

  const program = mapExlyProduct(product_name, lead?.program_interest);
  const weeks = getProgramWeeks(program);
  const now = new Date();
  const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await supabase
    .from('clients')
    .upsert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: null,
      status: 'active',
    }, { onConflict: 'phone' })
    .select()
    .single();

  if (error) {
    console.error('Client creation error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  if (lead) {
    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const folderPath = `clients/${client.id}`;
  await supabase.storage.from('clients').upload(`${client.id}/.keep`, new Blob(['']));
  await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const market = detectMarket(phone);
  const templateName = isHinglishMarket(market)
    ? `onboard_${program}_hi`
    : `onboard_${program}`;

  await sendTemplate(phone, templateName, [
    customer_name || lead?.name || 'Champion',
  ]);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week-1 program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};

function mapExlyProduct(productName, fallback) {
  if (!productName) return fallback || '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('6') || lower.includes('burn')) return '6wk_gym';
  return fallback || '6wk_gym';
}
