const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Determine program from checkout
    let program = '6wk_gym';
    const productLower = (product_name || '').toLowerCase();
    if (productLower.includes('pcos')) program = 'pcos';
    else if (productLower.includes('40')) program = '40plus';
    else if (productLower.includes('12') || productLower.includes('flagship')) program = '12wk';
    else if (productLower.includes('zoom') || productLower.includes('trial')) program = 'zoom_trial';
    else if (productLower.includes('home')) program = '6wk_home';

    // Calculate program end date
    const startDate = new Date();
    let weeks = 6;
    if (program === '12wk') weeks = 12;
    else if (program === 'zoom_trial') weeks = 1;
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Find or create lead
    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client record
    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('[Exly] Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    // Send onboarding WhatsApp template
    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    ]);

    // For 12-week program, trigger immediate program generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('[Exly] Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('[Exly Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
