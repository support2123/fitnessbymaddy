const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature if secret is set
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-webhook-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, phone, name, email,
      amount, product_name
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Determine program from product name or lead interest
    const program = detectProgram(product_name) || lead.program_interest || '6wk_gym';
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create or update client
    const { data: client, error } = await db.from('clients').upsert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id,
      status: 'active'
    }, { onConflict: 'lead_id' }).select().single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await db.storage.from('clients').upload(folderPath, new Uint8Array(0), {
      upsert: true
    });

    await db.from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    const market = lead.market || detectMarket(phone);
    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      name || 'there',
      `Week 1 starts now!`
    ]);

    // For 12-week: trigger immediate Week 1 program generation
    if (program === '12wk') {
      const baseUrl = process.env.BASE_URL || 'https://www.fitnessbymaddy.com';
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 gen failed:', err.message));
    }

    return res.status(200).json({ success: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('6 week') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  return null;
}
