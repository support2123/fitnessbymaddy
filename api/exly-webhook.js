const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product } = req.body || {};
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    if (!cleanPhone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    const program = (lead && lead.program_interest) || mapProductToProgram(product) || '6wk_gym';
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead ? lead.id : null,
      phone: cleanPhone,
      name: name || (lead && lead.name) || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }, {
      onConflict: 'phone',
    }).select('id').single();

    if (error) {
      console.error('exly client upsert error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(
      cleanPhone,
      `onboard_${program}`,
      [name || 'there'],
      name || 'there'
    );

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {}
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function mapProductToProgram(product) {
  if (!product) return null;
  const p = product.toLowerCase();
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40')) return '40plus';
  if (p.includes('12')) return '12wk';
  if (p.includes('home')) return '6wk_home';
  if (p.includes('trial') || p.includes('zoom')) return 'zoom_trial';
  if (p.includes('shred') || p.includes('burn') || p.includes('6')) return '6wk_gym';
  return null;
}
