const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-exly-secret'] || req.query.secret;
    if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const program = mapProductToProgram(product_name || '');
    const programDuration = getProgramDuration(program);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    await sendWhatsApp(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', program]
    });

    if (program === '12wk') {
      await fetch('https://fitnessbymaddy.com/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (/6.*week.*home|home.*6/i.test(lower)) return '6wk_home';
  if (/6.*week|shred|burn/i.test(lower)) return '6wk_gym';
  if (/12.*week|custom|flagship/i.test(lower)) return '12wk';
  if (/pcos|warrior/i.test(lower)) return 'pcos';
  if (/40|plus|strong/i.test(lower)) return '40plus';
  if (/trial/i.test(lower)) return 'zoom_trial';
  if (/zoom.*pack/i.test(lower)) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}
