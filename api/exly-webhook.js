const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

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

  const {
    customer_name, customer_email, customer_phone,
    product_name, amount, checkout_id, status,
  } = req.body;

  if (status !== 'paid' && status !== 'completed') {
    return res.status(200).json({ status: 'skipped', reason: 'not_paid' });
  }

  if (!customer_phone) {
    return res.status(200).json({ status: 'skipped', reason: 'no_phone' });
  }

  const db = getSupabase();

  try {
    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programStart = new Date();
    const weekCount = program === '12wk' ? 12 : 6;
    const programEnd = new Date(programStart);
    programEnd.setDate(programEnd.getDate() + weekCount * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name || lead?.name || 'Client',
      email: customer_email || null,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    await sendWhatsApp(customer_phone, `onboard_${program}`, {
      name: client.name,
      templateParams: [client.name, programStart.toLocaleDateString()],
    });

    if (program === '12wk') {
      await triggerWeek1Program(client.id);
    }

    return res.status(200).json({ status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

async function triggerWeek1Program(clientId) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId, week_no: 1 }),
    });
  } catch (err) {
    console.error('Failed to trigger week 1 program:', err.message);
  }
}
