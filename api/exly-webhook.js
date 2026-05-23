const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { getProgramInfo } = require('../lib/program-router');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { phone, email, name, amount, checkout_id, product_name } = req.body;

  if (!phone || !checkout_id) {
    return res.status(400).json({ error: 'phone and checkout_id required' });
  }

  const db = getSupabase();

  try {
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const programKey = lead?.program_interest || inferProgram(product_name, amount);
    const programInfo = getProgramInfo(programKey);
    const market = detectMarket(phone);
    const weeks = programInfo?.weeks || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: null,
      status: 'active'
    };

    let clientId;
    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert(clientData).select('id').single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.storage.from('clients').upload(`${clientId}/.keep`, new Uint8Array(0), {
      upsert: true
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

    const templateName = isHinglish(market)
      ? `onboard_${programKey}_hi`
      : `onboard_${programKey}_en`;

    await sendWhatsApp(phone, templateName, {
      name: name || lead?.name || 'there',
      templateParams: [
        name || lead?.name || 'there',
        programInfo?.name || 'your program'
      ]
    });

    return res.json({ success: true, client_id: clientId, program: programKey });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') && amount <= 25) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
