import supabase from '../lib/supabase.js';
import { sendTemplate, notifyMaddy } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import crypto from 'crypto';

const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', weeks: 6 },
  '12wk': { name: '12-Week Flagship', weeks: 12 },
  'pcos': { name: 'PCOS Warrior', weeks: 8 },
  '40plus': { name: '40+ Strong', weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial', weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack', weeks: 4 },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_id, amount, checkout_id,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const phone = customer_phone.replace(/[^0-9+]/g, '');
    const program = mapProduct(product_id);
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];
    const market = detectMarket(phone);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programInfo.weeks * 7);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || product_id,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = isHinglish(market)
      ? `onboard_${program}`
      : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week-1 gen error:', err.message));
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function mapProduct(productId) {
  const id = (productId || '').toLowerCase();
  if (id.includes('12') || id.includes('flagship') || id.includes('custom')) return '12wk';
  if (id.includes('pcos')) return 'pcos';
  if (id.includes('40') || id.includes('plus')) return '40plus';
  if (id.includes('home')) return '6wk_home';
  if (id.includes('trial')) return 'zoom_trial';
  if (id.includes('zoom') || id.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
