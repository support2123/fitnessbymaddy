import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, program, amount, checkout_id } = parseExlyPayload(req.body);

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email,
        program,
        paid_amount: amount,
        checkout_id,
        program_ends_at: programEnds,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateMap = {
      '6wk_gym': 'onboard_6wk',
      '6wk_home': 'onboard_6wk',
      '12wk': 'onboard_12wk',
      pcos: 'onboard_pcos',
      '40plus': 'onboard_40plus',
      zoom_trial: 'onboard_zoom',
      zoom_pack: 'onboard_zoom',
    };
    const template = templateMap[program] || 'onboard_general';
    await sendWhatsApp(phone, null, template, true);

    if (program === '12wk') {
      const genUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(genUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) => console.error('Week-1 gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.mobile || body.customer_phone || '',
    name: body.name || body.customer_name || '',
    email: body.email || body.customer_email || '',
    program: body.program || body.product_name || body.plan || '',
    amount: body.amount || body.total || 0,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || '',
  };
}
