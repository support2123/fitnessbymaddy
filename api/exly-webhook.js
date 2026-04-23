const { supabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/helpers');
const { sendTemplate } = require('./_lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const programKey = mapProductToProgram(product_name || product_id || '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDurations = {
      '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
      'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
    };
    const durationDays = programDurations[programKey] || 42;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationDays);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id: checkout_id || '',
      folder_url: '',
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${folderPath}.keep`, '', { upsert: true }
    );
    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${programKey}`, [name || 'there']);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('[Exly] Week-1 program gen failed:', e.message);
      }
    }

    console.log(`[Exly] Converted: ${maskPhone(phone)} → ${programKey} $${amount}`);
    return res.json({ status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('[Exly Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(product) {
  const lower = (product || '').toLowerCase();
  if (/6.?week.*home/i.test(lower)) return '6wk_home';
  if (/6.?week|shred|burn/i.test(lower)) return '6wk_gym';
  if (/12.?week|custom|flagship/i.test(lower)) return '12wk';
  if (/pcos|warrior/i.test(lower)) return 'pcos';
  if (/40|plus|strong/i.test(lower)) return '40plus';
  if (/zoom.*pack/i.test(lower)) return 'zoom_pack';
  if (/trial|zoom/i.test(lower)) return 'zoom_trial';
  return '6wk_gym';
}
