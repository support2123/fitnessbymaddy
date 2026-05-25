const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone, detectMarket } = require('./lib/helpers');

const PROGRAM_MAP = {
  '6wk_shred': '6wk_gym',
  '6_week_shred': '6wk_gym',
  '6wk_home': '6wk_home',
  'pcos_warrior': 'pcos',
  'pcos': 'pcos',
  '40plus_strong': '40plus',
  '40plus': '40plus',
  '12wk_flagship': '12wk',
  '12_week': '12wk',
  'custom': '12wk',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATION_DAYS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  const headerSecret = req.headers['x-exly-secret'];
  if (!webhookSecret || headerSecret !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  try {
    const { phone, email, name, product, program, amount, checkout_id } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const rawProgram = (product || program || '').toLowerCase().replace(/[\s-]+/g, '_');
    const programKey = PROGRAM_MAP[rawProgram] || '6wk_gym';
    const market = detectMarket(phone);
    const durationDays = PROGRAM_DURATION_DAYS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 86400000).toISOString();

    // Find or create lead, mark as converted
    let { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone, name: name || null, email: email || null,
          status: 'converted', source: 'exly', market,
          program_interest: programKey,
        })
        .select().single();
      lead = newLead;
    } else {
      await supabase.from('leads')
        .update({ status: 'converted', last_msg_at: now.toISOString() })
        .eq('id', lead.id);
    }

    // Create client record
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        phone, email: email || null, name: name || null,
        program: programKey,
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id: checkout_id || null,
        lead_id: lead?.id || null,
        status: 'active',
        program_started_at: now.toISOString(),
        program_ends_at: endsAt,
      })
      .select().single();

    if (clientErr) {
      console.error(`exly-webhook client insert [${maskPhone(phone)}]:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Set folder_url
    const folderUrl = `clients/${client.id}`;
    await supabase.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    // Create storage folder
    await supabase.storage
      .from('client-files')
      .upload(`${folderUrl}/.keep`, Buffer.from(''), { contentType: 'text/plain', upsert: true });

    // Send welcome WhatsApp
    await sendWhatsApp(phone, `onboard_${programKey}`, {
      templateParams: [name || 'there'],
    });

    // If 12-week program, trigger Week-1 generation
    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error(`Program gen failed [${maskPhone(phone)}]:`, genErr.message);
      }
    }

    return res.status(200).json({ status: 'purchase_processed', client_id: client.id });
  } catch (err) {
    console.error(`exly-webhook error [${maskPhone(req.body?.phone || '')}]:`, err.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
