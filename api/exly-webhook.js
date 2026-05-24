const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const crypto = require('crypto');

function verifySignature(body, signature, secret) {
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, name: '6 Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, name: '6 Week Burn & Build (Home)' },
  '12wk': { duration: 84, name: '12-Week Custom Flagship' },
  'pcos': { duration: 42, name: 'PCOS Warrior' },
  '40plus': { duration: 42, name: '40+ Strong' },
  'zoom_trial': { duration: 7, name: 'Zoom Trial Session' },
  'zoom_pack': { duration: 28, name: 'Zoom Session Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!verifySignature(req.body, signature, process.env.EXLY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: lead } = await db.from('leads')
          .select('phone')
          .eq('phone', customer_phone)
          .single();
        if (lead) {
          const { notifyMaddy } = require('../lib/whatsapp');
          await notifyMaddy('Payment Failed', `Phone: ${customer_phone}\nProduct: ${product_name}`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    const programKey = lead?.program_interest || detectProgramFromName(product_name);
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name || lead?.name || '',
      email: customer_email || '',
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || detectMarket(customer_phone);
    const templateName = market === 'IN' ? `onboard_${programKey}_hindi` : `onboard_${programKey}`;
    await sendTemplate(customer_phone, templateName, [
      customer_name || 'there',
      programInfo.name
    ]);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromName(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
