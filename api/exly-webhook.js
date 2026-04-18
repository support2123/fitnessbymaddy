const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const computed = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== computed) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status,
    } = req.body;

    if (!phone || status !== 'completed') {
      return res.status(200).json({ action: 'ignored', reason: 'incomplete or missing phone' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = mapProductToProgram(product_name || '');

    const programDuration = {
      '6wk_gym': 42,
      '6wk_home': 42,
      '12wk': 84,
      pcos: 42,
      '40plus': 42,
      zoom_trial: 7,
      zoom_pack: 30,
    };

    const days = programDuration[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);

    const clientData = {
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      status: 'active',
    };

    const { data: client } = await db
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Blob(['']))
      .catch(() => {});

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      `Day 7 (${new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN')})`,
    ]);

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
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ action: 'converted', clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
