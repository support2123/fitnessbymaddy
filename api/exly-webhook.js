const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, detectMarket } = require('./_lib/whatsapp');
const { getProgramName } = require('./_lib/qualify');
const crypto = require('crypto');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      checkout_id,
      buyer_phone,
      buyer_name,
      buyer_email,
      product_name,
      amount,
      currency
    } = req.body;

    if (!buyer_phone) {
      return res.status(400).json({ error: 'buyer_phone required' });
    }

    const phone = buyer_phone.replace(/\D/g, '');

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const programKey = lead?.program_interest || mapProductToProgram(product_name);
    const market = detectMarket(phone);

    const programStarted = new Date();
    const weeksDuration = programKey === '12wk' ? 12 : programKey?.startsWith('6wk') ? 6 : 4;
    const programEnds = new Date(programStarted.getTime() + weeksDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: buyer_name || lead?.name,
        email: buyer_email,
        program: programKey,
        program_started_at: programStarted.toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const isHinglish = market === 'IN';
    const programName = getProgramName(programKey);

    await sendTemplate(phone, `onboard_${programKey}`, {
      name: buyer_name || 'there',
      templateParams: [
        buyer_name || 'there',
        programName,
        `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=1`
      ]
    });

    if (programKey === '12wk') {
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
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program: programKey
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
