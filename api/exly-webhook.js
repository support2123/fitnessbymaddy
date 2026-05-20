const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('burn') && lower.includes('gym')) return '6wk_gym';
  if (lower.includes('burn') && lower.includes('home')) return '6wk_home';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

    const { buyer_phone, buyer_name, buyer_email, product_name, amount, checkout_id } = req.body;

    if (!buyer_phone) return res.status(400).json({ error: 'buyer_phone required' });

    const phone = buyer_phone.startsWith('+') ? buyer_phone : `+${buyer_phone}`;
    const program = mapExlyProduct(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const market = detectMarket(phone);

    let leadId = null;
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      leadId = existingLead.id;
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: buyer_name,
          source: 'exly',
          status: 'converted',
          market
        })
        .select()
        .single();
      leadId = newLead?.id;
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: buyer_name,
        email: buyer_email,
        program,
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [buyer_name || 'there']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
