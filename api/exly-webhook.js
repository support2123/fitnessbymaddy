const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Training',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

function verifyWebhookSignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6 week') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const db = getSupabase();
    const {
      customer_phone, customer_email, customer_name,
      product_name, amount, checkout_id, order_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not_paid' });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const program = mapExlyProduct(product_name);
    const now = new Date();
    const programWeeks = program === '12wk' ? 12 : program.startsWith('6wk') ? 6 : 4;
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name || '',
      email: customer_email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || order_id || null,
      status: 'active'
    }).select().single();

    if (client) {
      const folderPath = `clients/${client.id}/`;
      await db.storage.from('client-files').upload(
        `${folderPath}.keep`,
        Buffer.from(''),
        { contentType: 'text/plain', upsert: true }
      );
      await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);
    }

    const programLabel = PROGRAM_NAMES[program] || product_name;
    await sendWhatsApp(phone, `onboard_${program}`, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', programLabel]
    }, `Welcome to ${programLabel}! 🎉\n\nYour program starts now. Maddy's team will set everything up for you.\n\nYou'll receive your first check-in form in 7 days. Let's crush this! 💪`);

    if (program === '12wk' && client) {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client?.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
