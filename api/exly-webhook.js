const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramWeeks } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, name, email, product_name, amount,
      checkout_id, status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      return res.status(200).json({ action: 'ignored', reason: 'not a paid event' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const program = mapExlyProduct(product_name);
    const weeks = getProgramWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientError } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      String(weeks),
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('1-on-1') || lower.includes('vip')) return 'zoom_pack';
  return '6wk_gym';
}
