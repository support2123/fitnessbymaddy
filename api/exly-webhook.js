import supabase from './lib/supabase.js';
import { sendTemplate, sendText } from './lib/whatsapp.js';
import { logMessage } from './lib/rate-limit.js';
import { detectMarket } from './lib/market.js';
import crypto from 'crypto';

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || inferProgram(product_name);
    const market = lead?.market || detectMarket(phone);

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const welcomeMsg = market === 'IN'
      ? `Welcome to the team! 🎉 Tumhara ${formatProgram(program)} program officially shuru ho gaya hai. Maddy ki team tumhare saath hai har step pe. Pehla check-in Day 7 pe aayega!`
      : `Welcome to the team! 🎉 Your ${formatProgram(program)} program has officially started. Maddy's team is with you every step. Your first check-in arrives on Day 7!`;

    await sendText(phone, welcomeMsg);
    await logMessage(phone, 'out', welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      const genUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function formatProgram(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack',
  };
  return names[code] || code;
}
