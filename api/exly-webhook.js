import { getSupabase } from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import crypto from 'crypto';

const ONBOARD_MESSAGES = {
  '6wk_gym': { en: "Welcome to the 6-Week Burn & Build! 🔥 Your plan is ready. Let's crush it!", hinglish: "Welcome to 6-Week Burn & Build! 🔥 Tera plan ready hai. Ab shuru karte hain!" },
  '6wk_home': { en: "Welcome to the 6-Week Home Program! 💪 Everything you need, no gym required.", hinglish: "Welcome to 6-Week Home Program! 💪 Sab kuch ready hai, gym ki zarurat nahi!" },
  '12wk': { en: "Welcome to Maddy's 12-Week Flagship Program! ⭐ Your custom journey starts now. Week 1 plan coming shortly.", hinglish: "Welcome to Maddy ka 12-Week Flagship Program! ⭐ Tera custom journey ab shuru. Week 1 plan aata hai thodi der mein." },
  pcos: { en: "Welcome to the PCOS Warrior Program! 💜 Designed specifically for hormonal balance and sustainable results.", hinglish: "Welcome to PCOS Warrior Program! 💜 Hormonal balance aur sustainable results ke liye specially designed." },
  '40plus': { en: "Welcome to 40+ Strong! 🏋️ Smart training for lasting strength and vitality.", hinglish: "Welcome to 40+ Strong! 🏋️ Smart training, lasting strength aur energy ke liye." },
  zoom_trial: { en: "Your Zoom Trial is booked! 📹 Maddy's team will send you the session link within 24 hours.", hinglish: "Zoom Trial book ho gaya! 📹 Maddy ki team 24 ghante mein session link bhejegi." },
  zoom_pack: { en: "Welcome to the Zoom Coaching Pack! 📹 Your sessions are ready to be scheduled.", hinglish: "Welcome to Zoom Coaching Pack! 📹 Sessions schedule hone ke liye ready hain." }
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'];
  if (!signature) return false;

  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const db = getSupabase();
    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ ok: true, action: 'non_purchase_event' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = mapProductToProgram(product_name || product_id);
    const market = detectMarket(phone);
    const now = new Date();

    const programDuration = program === '12wk' ? 84 : 42;
    const endsAt = new Date(now.getTime() + programDuration * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || '',
      email: email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'text/plain', upsert: true }
    );

    const msgs = ONBOARD_MESSAGES[program] || ONBOARD_MESSAGES['6wk_gym'];
    const body = isHinglish(market) ? msgs.hinglish : msgs.en;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body,
      isClient: true
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Initial program generation failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function mapProductToProgram(productIdentifier) {
  if (!productIdentifier) return '6wk_gym';
  const lower = productIdentifier.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
