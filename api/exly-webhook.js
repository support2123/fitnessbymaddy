import { supabase } from './lib/supabase.js';
import { sendTemplate } from './lib/whatsapp.js';
import { logMessage } from './lib/rate-limit.js';
import crypto from 'crypto';

const EXLY_WEBHOOK_SECRET = process.env.EXLY_WEBHOOK_SECRET;

function verifySignature(payload, signature) {
  if (!EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { phone, checkout_id, amount, program_slug } = req.body;

  if (!phone || !checkout_id) {
    return res.status(400).json({ error: 'Missing phone or checkout_id' });
  }

  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);

    const program = program_slug || lead.program_interest || 'zoom_trial';
    const programDays = program === '12wk' ? 84 : program.includes('6wk') ? 42 : 30;
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: lead.name,
        email: null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id,
        folder_url: `/clients/${lead.id}/`,
        status: 'active',
      })
      .select()
      .single();

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [lead.name || 'there']);
    await logMessage(phone, 'out', `Onboarding: ${templateName}`, templateName);

    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
