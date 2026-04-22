const { supabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../lib/whatsapp');
const { programDuration, detectMarket } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, checkout_id, amount, product_name } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    const program = mapExlyProduct(product_name);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDuration(program) * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const market = detectMarket(phone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to the family! \u{1F389} Tumhara ${formatProgram(program)} program start ho gaya hai. Pehla check-in Day 7 ko aayega. Let's crush it! \u{1F4AA}`
      : `Welcome to the family! \u{1F389} Your ${formatProgram(program)} program starts now. First check-in coming on Day 7. Let's crush it! \u{1F4AA}`;

    await sendWhatsApp({ phone, message: welcomeMsg, templateName: `onboard_${program}` });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const name = productName.toLowerCase();
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('strong')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function formatProgram(program) {
  const names = {
    '6wk_gym': '6-Week Gym Shred',
    '6wk_home': '6-Week Home Shred',
    '12wk': '12-Week Custom',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}
