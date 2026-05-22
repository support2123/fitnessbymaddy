const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', status });
    }

    const db = getSupabase();

    const phone = (customer_phone || '').replace(/\D/g, '');
    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const program = mapExlyProduct(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDays = program === '12wk' ? 84 : 42;
    const startDate = new Date();
    const endDate = new Date(Date.now() + programDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || null,
      email: customer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { upsert: true }
    );

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, [
      customer_name || 'there',
      programDisplayName(program),
    ]);

    if (program === '12wk') {
      fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function programDisplayName(code) {
  const names = {
    '6wk_gym': '6 Week Burn & Build (Gym)',
    '6wk_home': '6 Week Burn & Build (Home)',
    '12wk': '12 Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack',
  };
  return names[code] || code;
}
