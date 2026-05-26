const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Session Pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      phone, email, name, amount,
      checkout_id, product_id, product_name
    } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || detectProgramFromProduct(product_name || product_id);
    const duration = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program: program || '6wk_gym',
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: `Welcome to ${programName}! Your program starts now. Check your email for next steps. We'll send your first check-in form in 7 days.`,
      params: [name || 'there', programName],
      isClient: true
    });

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
        console.error('Week-1 program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.customer_phone || body.mobile,
    email: body.email || body.customer_email,
    name: body.name || body.customer_name,
    amount: body.amount || body.paid_amount || body.total,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id,
    product_id: body.product_id || body.item_id,
    product_name: body.product_name || body.item_name
  };
}

function detectProgramFromProduct(product) {
  if (!product) return '6wk_gym';
  const lower = product.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
