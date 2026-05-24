const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
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

    const { phone, email, name, amount, checkout_id, product_name } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = mapProductToProgram(product_name, lead?.program_interest);
    const programWeeks = getProgramWeeks(program);
    const programEndsAt = new Date(Date.now() + programWeeks * 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      paid_amount: amount,
      checkout_id,
      program_ends_at: programEndsAt,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.mobile,
    email: body.email || body.customer_email,
    name: body.name || body.customer_name,
    amount: body.amount || body.total_amount || body.price,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id,
    product_name: body.product_name || body.listing_name || body.item_name || ''
  };
}

function mapProductToProgram(productName, fallbackInterest) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return fallbackInterest || '6wk_gym';
}

function getProgramWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[program] || 6;
}
