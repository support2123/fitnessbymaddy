const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature if secret is set
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalizedPhone = phone.replace(/[^0-9]/g, '');

    // Find the lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (!lead) {
      // Create lead if somehow they purchased without prior contact
      const { data: newLead } = await supabase.from('leads').insert({
        phone: normalizedPhone,
        name,
        source: 'exly_direct',
        status: 'converted',
        program_interest: mapProductToProgram(product_name)
      }).select().single();

      await createClient(newLead, { email, name, amount, checkout_id, product_name });
    } else {
      // Update lead status
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
      await createClient(lead, { email, name, amount, checkout_id, product_name });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function createClient(lead, { email, name, amount, checkout_id, product_name }) {
  const program = lead.program_interest || mapProductToProgram(product_name);
  const programDays = program === '12wk' ? 84 : program.startsWith('6wk') ? 42 : 30;
  const endsAt = new Date(Date.now() + programDays * 24 * 60 * 60 * 1000).toISOString();

  // Check if client already exists (from intake form pre-creation)
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .single();

  const clientData = {
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt,
    paid_amount: amount ? parseInt(amount) : null,
    checkout_id,
    folder_url: `/clients/${lead.id}/`,
    status: 'active'
  };

  let clientId;
  if (existing) {
    await supabase.from('clients').update(clientData).eq('id', existing.id);
    clientId = existing.id;
  } else {
    const { data } = await supabase.from('clients').insert(clientData).select().single();
    clientId = data.id;
  }

  // Create storage folder
  await supabase.storage.from('clients').upload(`${clientId}/.keep`, new Uint8Array(0), {
    upsert: true
  });

  // Send onboarding template
  const templateName = `onboard_${program}`;
  await sendTemplate(lead.phone, templateName, [name || lead.name || 'there']);

  // If 12-week, trigger week 1 program generation
  if (program === '12wk') {
    const baseUrl = process.env.APP_URL || 'https://fitnessbymaddy.com';
    try {
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      });
    } catch (err) {
      console.error('Week 1 program generation failed:', err.message);
    }
  }
}

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
