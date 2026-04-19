import crypto from 'crypto';
import { getSupabase } from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { maskPhone } from '../lib/mask-phone.js';

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Flagship' },
  'pcos': { weeks: 8, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, label: 'Zoom Sessions Pack' },
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

    const { phone, name, email, program, amount, checkout_id } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const db = getSupabase();
    const programInfo = PROGRAM_MAP[program] || { weeks: 6, label: program };
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programInfo.weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'Champion',
      programInfo.label,
      endsAt.toLocaleDateString('en-IN'),
    ], true);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${program}`);

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
