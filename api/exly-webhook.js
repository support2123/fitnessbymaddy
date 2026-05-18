const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { programLabel, maskPhone, parseBody, cors } = require('../lib/utils');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const signature = req.headers['x-exly-signature'];

    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      checkout_id, phone, email, name,
      product_name, amount, status
    } = body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await notifyMaddy(
          'Payment Failed',
          `Phone: ${maskPhone(phone)}\nProduct: ${product_name}\nAmount: ${amount}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = mapExlyProduct(product_name, lead?.program_interest);

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const programEnd = new Date();
    if (program === '12wk') programEnd.setDate(programEnd.getDate() + 84);
    else if (program.startsWith('6wk')) programEnd.setDate(programEnd.getDate() + 42);
    else programEnd.setDate(programEnd.getDate() + 30);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnd.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const label = programLabel(program);
    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      label
    ], true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week-1 program gen failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName, fallback) {
  if (!productName) return fallback || '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return fallback || '6wk_gym';
}
