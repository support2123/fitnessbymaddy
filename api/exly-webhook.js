const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
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

    const { phone, email, name, amount, checkout_id, product_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalizedPhone = normalizePhone(phone);
    const program = mapProduct(product_name);

    const { data: lead } = await supabase
      .from('leads').select('*').eq('phone', normalizedPhone).single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDays = {
      '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
      pcos: 42, '40plus': 42, zoom_trial: 7, zoom_pack: 28,
    };
    const days = programDays[program] || 42;
    const endsAt = new Date(Date.now() + days * 86400000).toISOString();

    const { data: client, error: clientError } = await supabase
      .from('clients').insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_ends_at: endsAt,
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      }).select().single();

    if (clientError) throw clientError;

    // Create storage folder
    const folderPath = `${client.id}/.keep`;
    await supabase.storage.from('clients')
      .upload(folderPath, Buffer.from(''), { upsert: true });
    await supabase.from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(normalizedPhone, `onboard_${program}`, [
      name || 'there',
    ]);

    // For 12-week, trigger immediate Week-1 program generation
    if (program === '12wk') {
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
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(normalizedPhone)} → ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function mapProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  return '6wk_gym';
}
