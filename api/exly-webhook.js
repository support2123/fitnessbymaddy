const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored_non_success' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'No customer phone' });
    }

    const supabase = getSupabase();

    const phone = customer_phone.startsWith('+')
      ? customer_phone
      : `+${customer_phone}`;

    const lead = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead.data) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.data.id);
    }

    const program = mapProductToProgram(product_name);

    const programStart = new Date();
    const programEnd = new Date();
    if (program.includes('12wk')) {
      programEnd.setDate(programEnd.getDate() + 84);
    } else if (program.includes('6wk')) {
      programEnd.setDate(programEnd.getDate() + 42);
    } else {
      programEnd.setDate(programEnd.getDate() + 30);
    }

    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.data?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: programStart.toISOString(),
        program_ends_at: programEnd.toISOString(),
        paid_amount: parseFloat(amount) || 0,
        checkout_id: checkout_id || null,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${newClient.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Blob(['']));

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', newClient.id);

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, {
      name: customer_name,
      templateParams: [customer_name || 'there']
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('strong')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
