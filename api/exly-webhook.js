const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is configured
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, order_id
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const normalized = phone.startsWith('+') ? phone : `+${phone}`;

    // Find or create lead
    let { data: lead } = await supabase()
      .from('leads')
      .select('*')
      .eq('phone', normalized)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase()
        .from('leads')
        .insert({
          phone: normalized,
          name,
          source: 'exly_purchase',
          status: 'converted'
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase()
        .from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', lead.id);
    }

    // Determine program from checkout or product name
    const program = detectProgramFromPurchase(checkout_id, product_name, lead.program_interest);

    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Create client
    const { data: client, error } = await supabase()
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: normalized,
        name: name || lead.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id: order_id || checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client creation error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase().storage
      .from('clients')
      .upload(folderPath, Buffer.from(''), { upsert: true });

    await supabase()
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send welcome template
    const templateName = `onboard_${program}`;
    await sendTemplate(normalized, templateName, [name || 'there']);

    // For 12-week program, trigger immediate Week-1 generation
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
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromPurchase(checkoutId, productName, interest) {
  const text = `${checkoutId || ''} ${productName || ''}`.toLowerCase();
  if (text.includes('12') || text.includes('custom') || text.includes('flagship')) return '12wk';
  if (text.includes('pcos')) return 'pcos';
  if (text.includes('40') || text.includes('strong')) return '40plus';
  if (text.includes('trial') || text.includes('zoom')) return 'zoom_trial';
  if (text.includes('home')) return '6wk_home';
  if (text.includes('shred') || text.includes('6') || text.includes('burn')) return '6wk_gym';
  return interest || '6wk_gym';
}
