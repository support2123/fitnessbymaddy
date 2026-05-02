const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  try {
    const { customer_name, customer_email, customer_phone, amount, checkout_id, product_name } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'No phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    const program = detectProgram(product_name, lead?.program_interest);

    const programEnd = new Date();
    if (program.includes('12wk')) {
      programEnd.setDate(programEnd.getDate() + 84);
    } else if (program.includes('6wk')) {
      programEnd.setDate(programEnd.getDate() + 42);
    } else {
      programEnd.setDate(programEnd.getDate() + 30);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name || lead?.name || '',
      email: customer_email || '',
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active'
    }).select().single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const templateName = `onboard_${program}`;
    await sendWhatsApp(customer_phone, templateName, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', program]
    }, true);

    if (program === '12wk') {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName, fallback) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return fallback || '6wk_gym';
}
