import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { maskPhone } from '../lib/mask.js';

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Flagship' },
  'pcos': { weeks: 8, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial' },
  'zoom_pack': { weeks: 4, label: 'Zoom Pack' },
};

function verifyWebhookSignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone,
      email,
      name,
      product_id,
      product_name,
      amount,
      checkout_id,
      status: paymentStatus,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    if (paymentStatus && paymentStatus !== 'completed' && paymentStatus !== 'paid') {
      console.log(`Payment not completed: ${paymentStatus}`);
      return res.status(200).json({ status: 'skipped', reason: paymentStatus });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    const program = detectProgram(product_id, product_name);
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + programInfo.weeks * 7);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation failed:', clientErr.message);
      return res.status(500).json({ error: 'Client creation failed' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(normalizedPhone, `onboard_${program}`, [
      name || 'there',
      programInfo.label,
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) => {
        console.error('Week-1 program generation trigger failed:', err.message);
      });
    }

    console.log(`Converted: ${maskPhone(normalizedPhone)} → ${programInfo.label}`);
    return res.status(200).json({ status: 'client_created', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function detectProgram(productId, productName) {
  const text = `${productId || ''} ${productName || ''}`.toLowerCase();
  if (text.includes('12') || text.includes('flagship') || text.includes('custom')) return '12wk';
  if (text.includes('pcos')) return 'pcos';
  if (text.includes('40') || text.includes('strong')) return '40plus';
  if (text.includes('home')) return '6wk_home';
  if (text.includes('zoom') && text.includes('pack')) return 'zoom_pack';
  if (text.includes('zoom') || text.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
