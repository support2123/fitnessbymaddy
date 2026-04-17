const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = PROGRAM_MAP[product_name] || inferProgram(product_name, amount);
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || order_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}.keep`, Buffer.from(''), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      customer_name || 'there',
      formatDate(endsAt),
    ], customer_name);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
