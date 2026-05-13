import crypto from 'crypto';
import supabase from './lib/supabase.js';
import { sendTemplate } from './lib/whatsapp.js';
import { detectMarket, isHinglish } from './lib/market.js';
import { sendEmail } from './lib/resend-client.js';

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12_week_custom': '12wk',
  '12wk': '12wk',
  'pcos_warrior': 'pcos',
  'pcos': 'pcos',
  '40_plus': '40plus',
  '40plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const hash = crypto.createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || ''));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, product_id, product_name,
      amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.json({ action: 'ignored', reason: 'not a completed purchase' });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name?.toLowerCase()?.replace(/\s+/g, '_')] || '6wk_gym';
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${phone}_${Date.now()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || '',
      email: email || '',
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id: checkout_id || '',
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = `onboard_${program}`;
    const welcomeMsg = hinglish
      ? [`Welcome to the family! 🎉 Aapka ${program.replace(/_/g, ' ')} program start ho gaya hai. Week 1 ka plan aata hai jaldi!`]
      : [`Welcome to the family! 🎉 Your ${program.replace(/_/g, ' ')} program has started. Your Week 1 plan is on its way!`];

    await sendTemplate(phone, templateName, welcomeMsg, true);

    if (email) {
      await sendEmail(email, 'Welcome to Fitness by Maddy! 🎉', `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
          <h1 style="color:#2C2C2C;">Welcome, ${name || 'Champion'}!</h1>
          <p>Your <strong>${program.replace(/_/g, ' ')}</strong> program is now active.</p>
          <p>You'll receive your first plan via WhatsApp shortly. Make sure to complete your weekly check-ins for the best results.</p>
          <p style="margin-top:30px;color:#6B6B6B;">— Team Fitness by Maddy</p>
        </div>
      `);
    }

    if (program === '12wk') {
      fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 program gen failed:', err));
    }

    return res.json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
