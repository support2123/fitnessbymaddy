const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret && req.headers['x-exly-secret'] !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const { buyer_phone, buyer_name, buyer_email, product_name, amount, checkout_id } = req.body;
    if (!buyer_phone) return res.status(400).json({ error: 'buyer_phone required' });

    const phone = buyer_phone.replace(/[^0-9]/g, '');

    const program = mapProductToProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: buyer_name || lead?.name,
      email: buyer_email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [buyer_name || 'there']);

    if (program === '12wk') {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    if (buyer_email && process.env.RESEND_API_KEY) {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
        to: buyer_email,
        subject: `Welcome to ${program === '12wk' ? '12-Week Custom Program' : 'Fitness by Maddy'}!`,
        html: `<p>Hi ${buyer_name || 'there'},</p>
<p>Welcome aboard! Your ${program} program starts now.</p>
<p>You'll receive your first check-in form on WhatsApp in 7 days.</p>
<p>— Team Maddy</p>`
      });
    }

    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Conversion failed' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
