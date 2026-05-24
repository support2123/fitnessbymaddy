const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret && req.headers['x-webhook-secret'] !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      phone, name, email, amount, checkout_id, product_name
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'phone and checkout_id required' });
    }

    const program = detectProgram(product_name, amount);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id}`;

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, '', { upsert: true });

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        durationDays / 7 + ' weeks'
      ]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgram(productName, amount) {
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('flagship')) return '12wk';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('zoom') && amount <= 25) return 'zoom_trial';
  if (name.includes('zoom')) return 'zoom_pack';
  if (amount >= 150) return '12wk';
  return '6wk_gym';
}
