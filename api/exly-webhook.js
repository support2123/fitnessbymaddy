const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, checkout_id,
      amount, product_name
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = detectProgram(product_name || '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      params: [name || 'there', program.replace(/_/g, ' ')]
    });

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo })
    });
  } catch (err) {
    console.error('Program generation trigger failed:', err.message);
  }
}
