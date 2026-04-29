const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const hash = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return hash === signature;
}

function mapExlyProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id,
    } = req.body;

    const phone = '+' + (customer_phone || '').replace(/^\+/, '');
    if (!phone || phone === '+') {
      return res.status(400).json({ error: 'No phone' });
    }

    const program = mapExlyProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let lead;
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', existingLead.id);
      lead = existingLead;
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: customer_name,
          source: 'exly_purchase',
          status: 'converted',
          program_interest: program,
          market: detectMarket(phone),
        })
        .select()
        .single();
      lead = newLead;
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: customer_name || lead.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: Math.round((amount || 0) * 100),
        checkout_id: checkout_id || order_id,
        status: 'active',
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', program],
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
