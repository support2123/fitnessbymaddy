const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const { email, phone, name, amount, checkout_id, product_name } = req.body;
    const db = getSupabase();

    const programKey = detectProgramFromProduct(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const programWeeks = programKey === '12wk' ? 12 : 6;
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : ''),
      email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${programKey}`, [name || 'there']);

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
