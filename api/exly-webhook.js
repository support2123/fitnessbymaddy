const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature if secret is set
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      event, customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id
    } = req.body;

    if (event !== 'payment.success') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const program = mapProductToProgram(product_name);

    // Find the lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program end date
    const startDate = new Date();
    const durationWeeks = program.startsWith('12wk') ? 12 : 6;
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    // Create client
    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('programs')
      .upload(folderPath, new Blob(['']));

    // Send onboarding template
    await sendTemplate(phone, `onboard_${program}`, [customer_name || 'there']);

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
