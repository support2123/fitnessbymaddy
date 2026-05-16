const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

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

    const { customer_phone, customer_name, customer_email, product_name, amount, checkout_id } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
    const program = mapProductToProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const programDuration = {
      '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
      'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
    };

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (programDuration[program] || 42));

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || null,
      email: customer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || null,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (lead?.id) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    if (client) {
      await supabase.storage.from('client-files').upload(
        `clients/${client.id}/.folder`, Buffer.from(''), { contentType: 'text/plain' }
      );
    }

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', program]
    }, true);

    if (program === '12wk' && client) {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return 'zoom_trial';
  const name = productName.toLowerCase();
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('plus')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('shred') || name.includes('6') || name.includes('burn')) return '6wk_gym';
  if (name.includes('zoom') && name.includes('pack')) return 'zoom_pack';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
