const { getSupabase } = require('./lib/supabase');
const { sendTemplate, normalizePhone, maskPhone } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/escalation');
const { logMessage } = require('./lib/rate-limit');
const crypto = require('crypto');

function verifySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return sig === expected;
}

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      checkout_id, phone, name, email,
      product_name, amount, status: paymentStatus,
    } = req.body;

    if (paymentStatus === 'failed') {
      const { data: lead } = await getSupabase()
        .from('leads')
        .select('id, name')
        .eq('phone', normalizePhone(phone))
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lead) {
        await notifyMaddy(
          'Payment failed',
          `${name || maskPhone(phone)} — ${product_name || 'unknown product'}`
        );
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    const normalizedPhone = normalizePhone(phone);
    const supabase = getSupabase();

    const program = detectProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select('id')
      .single();

    if (client) {
      const folderPath = `clients/${client.id}`;
      const placeholder = new Blob([''], { type: 'text/plain' });
      await supabase.storage
        .from('client-files')
        .upload(`${folderPath}/.keep`, placeholder, { upsert: true });

      await supabase
        .from('clients')
        .update({ folder_url: folderPath })
        .eq('id', client.id);
    }

    await sendTemplate(normalizedPhone, `onboard_${program}`, [name || 'there']);
    await logMessage(normalizedPhone, 'out', `Onboarding: ${program}`, `onboard_${program}`);

    if (program === '12wk' && client) {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', clientId: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
