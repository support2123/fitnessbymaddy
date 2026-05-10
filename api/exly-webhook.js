const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook secret
    const signature = req.headers['x-webhook-secret'] || req.headers['x-exly-signature'];
    if (signature !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, email, name, amount, product_name, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    // Find lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      // Create lead if not found (direct purchase)
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly_direct',
        status: 'converted'
      }).select().single();
    }

    const leadId = lead?.id || null;
    const program = mapProductToProgram(product_name || '');

    // Calculate program end date
    const startDate = new Date();
    const weeks = program === '12wk' ? 12 : 6;
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: `clients/${phone.replace(/[^0-9]/g, '')}`,
      status: 'active'
    }).select().single();

    // Update lead status
    if (leadId) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('client-data').upload(folderPath, '', {
      contentType: 'text/plain',
      upsert: true
    });

    // Send onboarding template
    await sendTemplate(phone, `onboard_${program}`, [name || 'Champion']);

    // For 12-week: trigger immediate Week-1 generation
    if (program === '12wk') {
      const generateUrl = `${getBaseUrl(req)}/api/generate-program`;
      fetch(generateUrl, {
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
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
