const crypto = require('crypto');
const supabase = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { isHinglishMarket } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, pcos: 42, '40plus': 42,
  '12wk': 84, zoom_trial: 7, zoom_pack: 30
};

const ONBOARD_TEMPLATES = {
  '6wk_gym': 'onboard_6wk',
  '6wk_home': 'onboard_6wk',
  pcos: 'onboard_pcos',
  '40plus': 'onboard_40plus',
  '12wk': 'onboard_12wk',
  zoom_trial: 'onboard_trial',
  zoom_pack: 'onboard_trial'
};

module.exports = async function handler(req, res) {
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

    const { customer_phone, customer_name, customer_email, checkout_id, amount, product_name } = req.body;
    if (!customer_phone) return res.status(400).json({ error: 'customer_phone required' });

    const phone = customer_phone.replace(/\D/g, '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || inferProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : 0,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (client) {
      const folderPath = `clients/${client.id}/`;
      await supabase.storage.from('clients').upload(
        `${folderPath}.keep`,
        new Uint8Array(0),
        { contentType: 'application/octet-stream', upsert: true }
      );
      await supabase.from('clients').update({
        folder_url: folderPath
      }).eq('id', client.id);
    }

    const market = lead?.market || 'GLOBAL';
    const template = ONBOARD_TEMPLATES[program] || 'onboard_6wk';
    const welcomeMsg = isHinglishMarket(market)
      ? `Welcome to FitnessByMaddy! Tumhara ${program.replace('_', ' ')} program start ho gaya hai. First check-in Day 7 pe aayega!`
      : `Welcome to FitnessByMaddy! Your ${program.replace('_', ' ')} program is now active. Your first check-in will arrive on Day 7!`;

    await sendWhatsApp(phone, welcomeMsg, template, true);

    if (program === '12wk' && client) {
      try {
        await fetch(`${getBaseUrl(req)}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Failed to trigger week-1 program generation:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
