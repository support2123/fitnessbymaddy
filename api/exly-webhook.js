const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { normalizePhone, detectMarket } = require('../lib/phone');
const { escalateToMaddy } = require('../lib/escalation');

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

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await escalateToMaddy({
          reason: 'Payment failed',
          phone: customer_phone,
          context: `${customer_name} — ${product_name} — $${amount}`,
        });
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone);
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, program_interest')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to the family! 🎉 Tumhara ${programDisplayName(program)} program start ho gaya hai. Pehla check-in Day 7 ko aayega. Let's go! 💪`
      : `Welcome to the family! 🎉 Your ${programDisplayName(program)} program has started. First check-in will be on Day 7. Let's go! 💪`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      params: [customer_name || 'there', programDisplayName(program)],
      body: welcomeMsg,
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function programDisplayName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return names[program] || program;
}
