const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const crypto = require('crypto');

function programDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_name
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const db = getSupabase();

    // Map product name to program
    const productLower = (product_name || '').toLowerCase();
    let program = 'zoom_trial';
    if (productLower.includes('12') || productLower.includes('custom') || productLower.includes('flagship')) program = '12wk';
    else if (productLower.includes('pcos')) program = 'pcos';
    else if (productLower.includes('40')) program = '40plus';
    else if (productLower.includes('home')) program = '6wk_home';
    else if (productLower.includes('shred') || productLower.includes('burn') || productLower.includes('6')) program = '6wk_gym';
    else if (productLower.includes('zoom') && productLower.includes('pack')) program = 'zoom_pack';

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted'
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate dates
    const startDate = new Date();
    const durationWeeks = programDurationWeeks(program);
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await db.storage.from('clients').upload(folderPath, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true
    });

    await db.from('clients').update({
      folder_url: `clients/${client.id}/`
    }).eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [
        name || 'there',
        durationWeeks.toString(),
        `https://fitnessbymaddy.com/checkin?c=${client.id}&w=1`
      ]
    });

    // For 12-week program, trigger Week 1 program generation
    if (program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
      ends_at: endDate.toISOString()
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
