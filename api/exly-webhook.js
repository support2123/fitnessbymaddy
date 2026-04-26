const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function normalizeProgram(raw) {
  if (!raw) return '6wk_gym';
  const lower = raw.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
  if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.customer_phone;
    const email = payload.email || payload.customer_email;
    const name = payload.name || payload.customer_name;
    const amount = payload.amount || payload.paid_amount || 0;
    const checkoutId = payload.checkout_id || payload.order_id || null;
    const rawProgram = payload.product_name || payload.program || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const sb = getSupabase();
    const program = normalizeProgram(rawProgram);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 86400000);

    const { data: lead } = await sb
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await sb.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name,
      email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round(parseFloat(amount) * 100),
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await sb.storage.from('programs').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { contentType: 'text/plain' }
    );

    await sb.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (err.message && err.message.includes('payment')) {
      await notifyMaddy('payment_failure', { error: err.message });
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
