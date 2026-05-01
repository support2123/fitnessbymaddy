const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

function mapProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6 week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '12wk';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      buyer_name, buyer_email, buyer_phone,
      product_name, amount, checkout_id, order_id
    } = req.body;

    const phone = normalizePhone(buyer_phone || '');
    if (!phone) return res.status(400).json({ error: 'No phone number in purchase' });

    const program = mapProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: buyer_name,
        email: buyer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: parseInt(amount) || 0,
        checkout_id: checkout_id || order_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true
      });

    await sendTemplate(phone, `onboard_${program}`, [
      buyer_name || 'there',
      program
    ]);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: `[purchase] ${product_name} - $${amount} - ${checkout_id || order_id}`,
      status: 'received'
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program gen error:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
