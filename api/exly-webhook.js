const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { maskPhone, calculateEndDate, cors } = require('../lib/helpers');
const crypto = require('crypto');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, checkout_id,
      amount, product_name
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let programCode = '6wk_gym';
    const pn = (product_name || '').toLowerCase();
    if (pn.includes('12') || pn.includes('custom') || pn.includes('flagship')) programCode = '12wk';
    else if (pn.includes('pcos')) programCode = 'pcos';
    else if (pn.includes('40')) programCode = '40plus';
    else if (pn.includes('home')) programCode = '6wk_home';
    else if (pn.includes('trial') || pn.includes('zoom')) programCode = 'zoom_trial';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      if (lead.program_interest) {
        programCode = lead.program_interest;
      }
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date().toISOString();
    const folderPath = `clients/${checkout_id || Date.now()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program: programCode,
      program_started_at: now,
      program_ends_at: calculateEndDate(now, programCode),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${programCode}`, [
      client.name || 'Champion'
    ]);

    if (programCode === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${programCode}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body && req.body.phone) {
      try {
        await sendText(MADDY_PHONE,
          `PAYMENT PROCESSING ERROR\nPhone: ${maskPhone(req.body.phone)}\n` +
          `Error: ${err.message.slice(0, 200)}\nPlease check manually.`
        );
      } catch (_) {}
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
