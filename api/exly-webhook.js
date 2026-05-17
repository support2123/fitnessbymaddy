const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = mapProductToProgram(product_name);
    const programDuration = getProgramDuration(program);

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: new Date(Date.now() + programDuration).toISOString(),
      status: 'active'
    };

    const { data: client, error } = await supabase
      .from('clients')
      .upsert(clientData, { onConflict: 'phone' })
      .select()
      .single();

    if (error) {
      console.error('Client upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    clientData.folder_url = folderPath;
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(phone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to FitnessByMaddy! 🎉 Aapka ${formatProgram(program)} program start ho gaya hai. Week 1 check-in Sunday ko aayega.`
      : `Welcome to FitnessByMaddy! 🎉 Your ${formatProgram(program)} program is now active. Expect your Week 1 check-in on Sunday.`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      params: [name || 'there', formatProgram(program)]
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

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 42 * 24 * 60 * 60 * 1000,
    '6wk_home': 42 * 24 * 60 * 60 * 1000,
    '12wk': 84 * 24 * 60 * 60 * 1000,
    'pcos': 42 * 24 * 60 * 60 * 1000,
    '40plus': 42 * 24 * 60 * 60 * 1000,
    'zoom_trial': 7 * 24 * 60 * 60 * 1000,
    'zoom_pack': 28 * 24 * 60 * 60 * 1000
  };
  return durations[program] || 42 * 24 * 60 * 60 * 1000;
}

function formatProgram(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}
