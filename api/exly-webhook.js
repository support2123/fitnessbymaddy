const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { escalate } = require('./_lib/escalation');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhookSecret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (webhookSecret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      checkout_id, phone, name, email,
      product_name, amount, status: paymentStatus
    } = req.body;

    if (paymentStatus === 'failed') {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (existingClient) {
        await escalate('Payment failed for active client', phone, `Amount: ${amount}`);
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'ignored', status: paymentStatus });
    }

    const program = inferProgram(product_name, amount);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone, name, email, program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('client-data')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'Champion']);

    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      try {
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

    return res.status(200).json({ ok: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (amount && amount <= 25) return 'zoom_trial';
  return '6wk_gym';
}
