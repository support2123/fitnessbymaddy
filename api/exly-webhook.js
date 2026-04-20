import crypto from 'crypto';
import supabase from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { maskPhone } from './_lib/mask.js';

const PROGRAM_MAP = {
  '6wk-burn': '6wk_gym',
  '6wk-home': '6wk_home',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  '12wk-flagship': '12wk',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  'pcos': 42,
  '40plus': 42,
  '12wk': 84,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { phone, name, email, checkout_id, amount, product_id } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = PROGRAM_MAP[product_id] || product_id || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', last_msg_at: now.toISOString() })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('program', program)
      .eq('status', 'active')
      .maybeSingle();

    let clientId;

    if (existingClient) {
      clientId = existingClient.id;
      await supabase
        .from('clients')
        .update({ paid_amount: parseFloat(amount) || 0, checkout_id })
        .eq('id', existingClient.id);
    } else {
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert({
          lead_id: lead?.id || null,
          phone: normalizedPhone,
          name: name || lead?.name || null,
          email: email || null,
          program,
          program_started_at: now.toISOString(),
          program_ends_at: endsAt.toISOString(),
          paid_amount: parseFloat(amount) || 0,
          checkout_id,
          folder_url: null,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Blob(['']))
      .catch(() => {});

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    await sendWhatsApp(normalizedPhone, `onboard_${program}`, [
      name || 'there',
      `Your ${getProgramName(program)} starts now! 🎉`,
    ], true);

    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      }).catch(err => console.error(`Week-1 gen failed: ${err.message}`));
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error(`Exly webhook error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function normalizePhone(phone) {
  let cleaned = (phone || '').replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function getProgramName(key) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Edition',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Flagship Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack',
  };
  return names[key] || key;
}
