const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { event, data } = req.body;

    if (event !== 'payment.success' && event !== 'order.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = data.customer_phone || data.phone;
    const email = data.customer_email || data.email;
    const name = data.customer_name || data.name;
    const amount = data.amount || data.paid_amount;
    const checkoutId = data.checkout_id || data.order_id;
    const productSlug = data.product_slug || data.item_name || '';

    const program = slugToProgram(productSlug);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programDuration = getProgramDuration(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: lead ? lead.id : null,
        phone,
        name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id: checkoutId,
        status: 'active'
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, {
      name,
      templateParams: [name, getProgramName(program), programDuration.toString()]
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function slugToProgram(slug) {
  const s = slug.toLowerCase();
  if (s.includes('6-week-burn') || s.includes('6wk') || s.includes('shred')) return '6wk_gym';
  if (s.includes('home')) return '6wk_home';
  if (s.includes('12-week') || s.includes('custom') || s.includes('flagship')) return '12wk';
  if (s.includes('pcos')) return 'pcos';
  if (s.includes('40') || s.includes('strong')) return '40plus';
  if (s.includes('trial')) return 'zoom_trial';
  if (s.includes('pack')) return 'zoom_pack';
  return 'zoom_trial';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Shred',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom 4-Pack'
  };
  return names[program] || program;
}
