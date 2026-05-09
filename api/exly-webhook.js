const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { programLabel, programPrice } = require('./lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const supabase = getSupabase();
    const {
      phone, email, name, checkout_id, amount,
      product_name, product_id,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = mapProduct(product_name || product_id);

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

    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || programPrice(program) * 100,
        checkout_id,
        status: 'active',
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const label = programLabel(program);
    const welcomeMsg = `Welcome to ${label}! Your program starts now. You'll receive your first check-in form in 7 days. Let's get to work!`;
    await sendWhatsApp(phone, welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
    });
  } catch (err) {
    console.error('Failed to trigger program generation:', err.message);
  }
}
