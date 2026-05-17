const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

function verifySignature(payload, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_MAP = {
  '6-week-shred-gym': '6wk_gym',
  '6-week-shred-home': '6wk_home',
  '6-week-shred': '6wk_gym',
  '12-week-custom': '12wk',
  'pcos-warrior': 'pcos',
  '40-plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, product_slug, amount, checkout_id,
      order_id
    } = req.body;

    const phone = customer_phone || '';
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programSlug = product_slug || product_name || '';
    const program = PROGRAM_MAP[programSlug.toLowerCase()] || '12wk';

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: customer_name,
          source: 'exly',
          status: 'converted',
          program_interest: program
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    // Calculate program end date
    const startDate = new Date();
    const weeks = program.startsWith('6wk') ? 6 : program === '12wk' ? 12 : 4;
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: customer_name || lead.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id: checkout_id || order_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true
    });

    await supabase
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding WhatsApp template
    await sendTemplate(phone, `onboard_${program}`, {
      name: customer_name || '',
      templateParams: [customer_name || 'there']
    });

    // For 12-week program: trigger immediate Week-1 generation
    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week-1 gen failed:', err.message));
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
