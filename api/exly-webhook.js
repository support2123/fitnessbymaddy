const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy, PROGRAM_NAMES } = require('./_lib/escalation');

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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });
    if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
      await escalateToMaddy('Payment failure', phone, `Amount: ${amount}, Status: ${paymentStatus}`);
      return res.status(200).json({ action: 'payment_failed' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, program_interest, market')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || guessProgram(product_name, amount);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select('id').single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    const programName = PROGRAM_NAMES[program] || program;
    await sendTemplate(phone, templateName, [name || 'Champion', programName]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Initial program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function guessProgram(productName, amount) {
  if (!productName && !amount) return '6wk_gym';
  const name = (productName || '').toLowerCase();
  const amt = parseInt(amount, 10) || 0;
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('custom') || amt >= 150) return '12wk';
  if (name.includes('trial') || name.includes('zoom') || amt <= 25) return 'zoom_trial';
  if (name.includes('home')) return '6wk_home';
  return '6wk_gym';
}
