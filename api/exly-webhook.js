const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product_name, amount, checkout_id } = req.body;
    if (!phone || !checkout_id) return res.status(400).json({ error: 'Missing fields' });

    const program = mapProduct(product_name);
    const duration = PROGRAM_DURATION[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + duration * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase.from('leads')
      .select('*').eq('phone', phone).order('created_at', { ascending: false }).limit(1).single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const clientId = crypto.randomUUID();
    const folderUrl = `clients/${clientId}`;

    await supabase.from('clients').insert({
      id: clientId,
      lead_id: lead?.id || null,
      phone, name, email, program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id, folder_url: folderUrl, status: 'active'
    });

    await supabase.storage.from('clients').upload(`${clientId}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain', upsert: true
    });

    const market = detectMarket(phone);
    const tpl = isHinglish(market) ? `onboard_${program}_hi` : `onboard_${program}`;
    await sendTemplate(phone, tpl, [name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch {}
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('pack')) return 'zoom_pack';
  return 'zoom_trial';
}
