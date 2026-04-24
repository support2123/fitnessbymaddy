const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { PROGRAM_NAMES } = require('../lib/qualify');

// Flow C — Exly purchase confirmation webhook
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature if secret is set
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      // Payment failed — notify Maddy if this was an active lead
      if (status === 'failed') {
        await notifyMaddy('Payment Failed', `${name || phone} — ${product_name}`);
      }
      return res.status(200).json({ ok: true, note: 'Non-completed status' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    // Map Exly product to our program codes
    const program = mapExlyProduct(product_name || product_id);

    // Find the lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    // Update lead status to converted
    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    // Calculate program end date
    const startDate = new Date();
    const weeksDuration = program === '12wk' ? 12 : 6;
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeksDuration * 7);

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: cleanPhone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder for client
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, new Uint8Array(0), {
      contentType: 'application/octet-stream', upsert: true
    });
    const folderUrl = `clients/${client.id}/`;
    await supabase.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    // Send onboarding WhatsApp template
    const templateName = `onboard_${program}`;
    await sendTemplate(cleanPhone, templateName, [
      client.name || 'there',
      PROGRAM_NAMES[program] || program,
      endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    ]);

    // For 12-week: trigger immediate Week 1 program generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return 'zoom_trial';
}
