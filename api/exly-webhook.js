const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const {
      phone, name, email, product_name, amount, checkout_id
    } = req.body;

    const normalizedPhone = normalizePhone(phone || '');
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = detectProgram(product_name || '');
    const sb = getSupabase();

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await sb.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await sb.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: normalizedPhone,
      name: name || (lead ? lead.name : null),
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error(`[exly-webhook] Insert error: ${error.message}`);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await sb.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));

    await sb.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(normalizedPhone, `onboard_${program}`, {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        programLabel(program),
        `Day 7 check-in coming soon!`
      ]
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error(`[exly-webhook] Program gen trigger failed: ${err.message}`);
      }
    }

    console.log(`[exly-webhook] Client created: ${maskPhone(normalizedPhone)} → ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error(`[exly-webhook] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}

function normalizePhone(phone) {
  let p = (phone || '').replace(/[^0-9+]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}
