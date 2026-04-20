const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6 week')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify webhook signature if secret is set
  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expectedSig = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expectedSig) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id
    } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'customer_phone required' });

    const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;
    const program = mapExlyProduct(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

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

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: customer_name || lead.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || order_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder path
    const folderUrl = `/clients/${client.id}/`;
    await supabase
      .from('clients')
      .update({ folder_url: folderUrl })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      program,
      startDate.toLocaleDateString('en-IN')
    ]);

    // For 12-week program: trigger immediate Week-1 generation
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

    console.log(`Conversion: ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
