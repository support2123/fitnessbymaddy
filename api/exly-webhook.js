const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, order_id
    } = req.body;

    const phone = customer_phone
      ? (customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone)
      : null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const program = mapExlyProduct(product_name);
    const duration = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client record
    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead.id,
      phone,
      name: customer_name || lead.name || 'Client',
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id: checkout_id || order_id || null,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (error) throw error;

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true
    });
    await supabase.from('clients').update({
      folder_url: `/clients/${client.id}/`
    }).eq('id', client.id);

    // Send onboarding WhatsApp template
    await sendTemplate(phone, `onboard_${program}`, {
      name: customer_name || 'there',
      isClient: true,
      templateParams: [customer_name || 'there']
    });

    // For 12-week program: trigger immediate Week 1 program generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
