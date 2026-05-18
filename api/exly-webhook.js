const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');

const PROGRAM_DURATION = {
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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

    const {
      checkout_id, customer_name, customer_email,
      customer_phone, product_name, amount, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        await notifyMaddy(
          'Payment failed',
          `Customer: ${customer_name}\nPhone: ${customer_phone}\nAmount: ${amount}\nProduct: ${product_name}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone);
    const program = detectProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 86400000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: Math.round(parseFloat(amount) * 100),
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${folderPath}.keep`,
      '',
      { contentType: 'text/plain', upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there'
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
