const { getClient } = require('../lib/supabase');
const { sendTemplate, sendToMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

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

  const sb = getClient();
  const {
    buyer_phone, buyer_name, buyer_email,
    product_name, amount, checkout_id, transaction_id
  } = req.body;

  const phone = normalizePhone(buyer_phone || '');
  if (!phone) return res.status(400).json({ error: 'No phone number in payload' });

  const { data: lead } = await sb
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = mapProductToProgram(product_name, lead?.program_interest);
  const durationDays = PROGRAM_DURATION[program] || 42;
  const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  if (lead) {
    await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client } = await sb.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: buyer_name || lead?.name || null,
    email: buyer_email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt,
    paid_amount: amount ? Math.round(amount * 100) : null,
    checkout_id: checkout_id || transaction_id || null,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (client) {
    const folderPath = `clients/${client.id}`;
    await sb.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));
    await sb.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);
  }

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, {
    name: buyer_name || 'there',
    templateParams: [buyer_name || 'there', program.replace(/_/g, ' ')]
  });

  if (program === '12wk' && client) {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week-1 generation trigger failed:', err.message);
    }
  }

  await sendToMaddy(
    `NEW CONVERSION\nName: ${buyer_name || 'N/A'}\nPhone: ${maskPhone(phone)}\nProgram: ${program}\nAmount: $${amount || 'N/A'}`
  );

  return res.status(200).json({ ok: true, clientId: client?.id, program });
};

function mapProductToProgram(productName, leadInterest) {
  if (!productName) return leadInterest || '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return leadInterest || '6wk_gym';
}

function normalizePhone(raw) {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) phone = '+' + phone;
  return phone;
}
