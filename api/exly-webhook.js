const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

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

    const { phone, email, name, amount, checkout_id, product_name } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const program = detectProgram(product_name, amount);
    const duration = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const clientId = crypto.randomUUID();
    const folderPath = `clients/${clientId}`;

    const { error: insertError } = await supabase.from('clients').insert({
      id: clientId,
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    });

    if (insertError) {
      if (insertError.code === '23505') {
        await supabase.from('clients')
          .update({ program, paid_amount: amount, checkout_id, status: 'active', program_started_at: new Date().toISOString(), program_ends_at: programEnds })
          .eq('phone', phone);
      } else {
        throw insertError;
      }
    }

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      program.replace(/_/g, ' ')
    ]);

    if (program === '12wk') {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.mobile,
    email: body.email || body.customer_email,
    name: body.name || body.customer_name,
    amount: body.amount || body.paid_amount || 0,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id,
    product_name: body.product_name || body.item_name || ''
  };
}

function detectProgram(productName, amount) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12 week') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (amount >= 150) return '12wk';
  if (amount >= 40 && amount < 60) return 'pcos';
  return '6wk_gym';
}
