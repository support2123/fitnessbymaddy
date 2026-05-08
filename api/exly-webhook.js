const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programWeeks, PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      event, customer_phone, customer_name, customer_email,
      product_id, amount, checkout_id,
    } = req.body;

    if (event !== 'purchase.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = customer_phone;
    if (!phone) {
      return res.status(400).json({ error: 'No phone' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapExlyProduct(product_id);
    const weeks = programWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select('id').single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {}
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await escalateToMaddy('Payment webhook error', req.body?.customer_phone || 'unknown', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productId) {
  const map = {
    '6wk_gym': '6wk_gym',
    '6wk_home': '6wk_home',
    '12wk': '12wk',
    'pcos': 'pcos',
    '40plus': '40plus',
    'zoom_trial': 'zoom_trial',
    'zoom_pack': 'zoom_pack',
  };
  return map[productId] || '6wk_gym';
}
