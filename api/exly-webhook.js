import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { sendTemplate, notifyMaddy } from '../lib/whatsapp.js';

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, name: '6-Week Burn & Build (Home)' },
  '12wk': { duration: 84, name: '12-Week Flagship' },
  'pcos': { duration: 42, name: 'PCOS Warrior' },
  '40plus': { duration: 42, name: '40+ Strong' },
  'zoom_trial': { duration: 7, name: 'Zoom Trial Session' },
  'zoom_pack': { duration: 30, name: 'Zoom Pack' }
};

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      checkout_id, amount, product_name
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || '6wk_gym';
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || 0,
        checkout_id,
        folder_url: null,
        status: 'active'
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (error) throw error;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      customer_name || 'there',
      programInfo.name
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programInfo.name
    });

  } catch (err) {
    console.error('Exly webhook error:', err);

    await notifyMaddy(
      'Payment webhook error',
      `Error processing purchase: ${err.message}`
    ).catch(() => {});

    return res.status(500).json({ error: 'Internal error' });
  }
}
