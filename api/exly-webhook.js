const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      order_id
    } = req.body;

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No phone' });

    // Map Exly product to our program key
    const programKey = mapProduct(product_name);
    if (!programKey) {
      console.error(`Unknown product: ${product_name}`);
      return res.status(200).json({ action: 'unknown_product_logged' });
    }

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly_direct',
        status: 'converted',
        program_interest: programKey,
        market: 'GLOBAL'
      }).select('id').single();
      lead = newLead;
    } else {
      await db.from('leads')
        .update({ status: 'converted', program_interest: programKey })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    // Create client record
    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: customer_name,
      email: customer_email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: Math.round(amount * 100),
      checkout_id: checkout_id || order_id,
      folder_url: null,
      status: 'active'
    }).select('id').single();

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${programKey}`, {
      name: customer_name || 'there',
      templateParams: [
        customer_name || 'there',
        programKey.replace(/_/g, ' ').toUpperCase()
      ]
    });

    // For 12-week program: trigger immediate program generation
    if (programKey === '12wk') {
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
        console.error('Failed to trigger program gen:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${programKey} ($${amount})`);
    return res.status(200).json({ action: 'client_created', client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('6 week') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6 week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return null;
}
