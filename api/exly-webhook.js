const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, isHinglish, detectMarket } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await notifyMaddy('Payment failed', `Phone: ${maskPhone(customer_phone)}\nProduct: ${product_name}`);
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!customer_phone) return res.status(400).json({ error: 'Missing customer_phone' });

    const db = getSupabase();
    const cleanPhone = customer_phone.replace(/[^0-9]/g, '');
    const program = PROGRAM_MAP[product_name] || '6wk_gym';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const market = detectMarket(cleanPhone);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationWeeks * 7);

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: cleanPhone,
      name: customer_name || null,
      email: customer_email || null,
      program,
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert failed for', maskPhone(cleanPhone), clientErr.message);
      return res.status(500).json({ error: 'Database error' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = isHinglish(market) ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendTemplate(cleanPhone, templateName, [
      customer_name || 'there',
      `Week 1`,
    ], customer_name);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
