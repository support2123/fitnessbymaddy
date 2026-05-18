const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { PROGRAMS } = require('../lib/programs');
const crypto = require('crypto');

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

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not completed' });
    }

    const phone = normalizePhone(customer_phone);
    const db = getSupabase();

    const programSlug = detectProgramFromProduct(product_name, amount);
    const programInfo = PROGRAMS[programSlug] || PROGRAMS['6wk_gym'];
    const market = detectMarket(phone);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    const leadId = lead ? lead.id : null;

    if (leadId) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.duration_weeks * 7);

    const { data: client, error: clientError } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name,
        email: customer_email,
        program: programSlug,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || programInfo.price,
        checkout_id: checkout_id || null,
        status: 'active',
        market
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const templateName = `onboard_${programSlug}`;
    if (isHinglish(market)) {
      await sendTemplate(phone, templateName + '_hi', [customer_name, programInfo.name]);
    } else {
      await sendTemplate(phone, templateName + '_en', [customer_name, programInfo.name]);
    }

    if (programSlug === '12wk') {
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
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return '';
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function detectProgramFromProduct(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();

  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('1-on-1') || lower.includes('vip')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';

  if (amount) {
    const a = parseFloat(amount);
    if (a <= 25) return 'zoom_trial';
    if (a <= 50) return 'pcos';
    if (a <= 100) return '6wk_gym';
    if (a >= 200) return '12wk';
  }

  return '6wk_gym';
}
