const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_name,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus === 'failed') {
      await notifyMaddy('Payment failed', {
        phone: phone || 'unknown',
        detail: `${name || 'Unknown'} - ${product_name || 'Unknown program'}`,
      });
      return res.status(200).json({ action: 'payment_failed_notified' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    };

    let clientId;
    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db
        .from('clients')
        .insert(clientData)
        .select('id')
        .single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });
    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      program,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('pcos') || name.includes('hormonal')) return 'pcos';
  if (name.includes('40') || name.includes('strong')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('zoom pack')) return 'zoom_pack';
  return '6wk_gym';
}
