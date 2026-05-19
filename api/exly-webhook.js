const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { getProgramDetails } = require('./lib/programs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      status
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      return res.status(200).json({ status: 'ignored', reason: 'not a payment event' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone is required' });
    }

    const phone = customer_phone.replace(/\D/g, '');
    const programKey = mapExlyProduct(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const details = getProgramDetails(programKey);
    const programEndsAt = details
      ? new Date(Date.now() + details.duration_weeks * 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt,
      paid_amount: amount || (details ? details.price * 100 : 0),
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const templateName = `onboard_${programKey}`;
    await sendTemplate(phone, templateName, [
      customer_name || 'there',
      details?.name || product_name
    ]);

    if (programKey === '12wk') {
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead?.id || client.id}`;
      await sendTemplate(phone, 'intake_form_link', [
        customer_name || 'there',
        intakeUrl
      ]);
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
