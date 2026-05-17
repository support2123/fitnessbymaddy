const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

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

    const { checkout_id, customer_phone, customer_name, customer_email, amount, product_name } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = mapProductToProgram(product_name || '');
    const programDuration = getProgramDuration(program);

    const clientData = {
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      paid_amount: amount,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: new Date(Date.now() + programDuration).toISOString(),
      status: 'active'
    };

    if (lead) {
      clientData.lead_id = lead.id;
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0));

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || 'GLOBAL';
    const welcomeMsg = market === 'IN'
      ? `Welcome to the ${getProgramName(program)} program! 🎉\n\nTumhara journey officially start ho gaya hai. First week ka plan incoming — taiyaar raho! 💪`
      : `Welcome to the ${getProgramName(program)} program! 🎉\n\nYour journey officially starts now. Your first week plan is incoming — get ready! 💪`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
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
    'zoom_pack': 30 * 24 * 60 * 60 * 1000
  };
  return durations[program] || 42 * 24 * 60 * 60 * 1000;
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}
