const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, email, name, amount, checkout_id, product } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'No phone in payment data' });
    }

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly_direct',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await supabase.from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', lead.id);
    }

    // Determine program from lead interest or product name
    const program = lead.program_interest || mapProductToProgram(product);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Create client record
    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Send onboarding message
    await sendWhatsApp(phone, `onboard_${program}`, {
      name: client.name || 'there',
      templateParams: [client.name || 'there']
    });

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.mobile,
    email: body.email || body.customer_email,
    name: body.name || body.customer_name,
    amount: body.amount || body.paid_amount || body.total,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id,
    product: body.product || body.product_name || body.item_name
  };
}

function mapProductToProgram(product) {
  if (!product) return '6wk_gym';
  const lower = product.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
