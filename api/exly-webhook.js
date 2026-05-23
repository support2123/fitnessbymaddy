const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 30,
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6') && lower.includes('gym')) return '6wk_gym';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6')) return '6wk_gym';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '12wk';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (sig) {
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const db = getSupabase();
  const {
    customer_name, customer_email, customer_phone,
    product_name, amount, checkout_id, order_id
  } = req.body;

  const phone = customer_phone || '';
  const program = mapExlyProduct(product_name);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  let clientId;

  if (existingClient) {
    await db.from('clients').update({
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || order_id || null,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      name: customer_name || undefined,
      email: customer_email || undefined,
    }).eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || order_id || null,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      status: 'active',
    }).select().single();
    clientId = newClient?.id;
  }

  const folderPath = `clients/${clientId}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    upsert: true,
  });

  await db.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

  await sendWhatsApp({
    phone,
    templateName: `onboard_${program}`,
    params: [customer_name || 'there'],
  });

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (e) {
      // Async generation — logged separately
    }
  }

  return res.status(200).json({ ok: true, client_id: clientId, program });
};
