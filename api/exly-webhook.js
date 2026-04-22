const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  try {
    const { phone, email, name, product, amount, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = mapProduct(product);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));
    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        await fetch(
          `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: client.id, week_no: 1 }),
          }
        );
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(product) {
  if (!product) return '6wk_gym';
  const p = product.toLowerCase();
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40') || p.includes('strong')) return '40plus';
  if (p.includes('12') || p.includes('custom') || p.includes('flagship')) return '12wk';
  if (p.includes('home')) return '6wk_home';
  if (p.includes('trial')) return 'zoom_trial';
  if (p.includes('zoom') || p.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
