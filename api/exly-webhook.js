import supabase from './lib/supabase.js';
import { sendText, sendTemplate } from './lib/whatsapp.js';
import { detectMarket, isHinglishMarket } from './lib/market.js';
import { PROGRAMS, BASE_URL } from './lib/constants.js';

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') || lower.includes('6wk') || lower.includes('shred')) {
    return lower.includes('home') ? '6wk_home' : '6wk_gym';
  }
  if (lower.includes('12 week') || lower.includes('12wk') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('40plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('pack') || lower.includes('4 session')) return 'zoom_pack';
  return '12wk';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret && req.headers['x-webhook-secret'] !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id,
    } = req.body;

    const phone = customer_phone?.replace(/[^0-9]/g, '') || '';
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const program = mapExlyProduct(product_name);
    const programInfo = PROGRAMS[program];
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + (programInfo.duration_weeks * 7));

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    let leadId = lead?.id;
    if (!leadId) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone),
      }).select('id').single();
      leadId = newLead?.id;
    } else {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: client, error: clientError } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name || null,
      email: customer_email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id: checkout_id || order_id || null,
      folder_url: `clients/${leadId}/`,
      status: 'active',
    }).select('id').single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    const onboardMsg = hinglish
      ? `Welcome to ${programInfo.name}! 🎉\n\nMaddy ki team yahan hai tumhare saath. Tumhara program start ho gaya hai.\n\nPehla check-in Day 7 pe hoga. Tab tak — full dedication! 💪`
      : `Welcome to ${programInfo.name}! 🎉\n\nMaddy's team is here with you. Your program starts now.\n\nYour first check-in will be on Day 7. Until then — full dedication! 💪`;

    await sendText(phone, onboardMsg, true);

    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://www.fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
}
