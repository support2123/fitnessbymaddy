import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';

const PROGRAM_MAP = {
  '6wk-gym': { program: '6wk_gym', weeks: 6 },
  '6wk-home': { program: '6wk_home', weeks: 6 },
  '12wk-custom': { program: '12wk', weeks: 12 },
  'pcos-warrior': { program: 'pcos', weeks: 6 },
  '40plus-strong': { program: '40plus', weeks: 6 },
  'zoom-trial': { program: 'zoom_trial', weeks: 1 },
  'zoom-4pack': { program: 'zoom_pack', weeks: 4 },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_id,
      status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const { data: existingClient } = await supabase
          .from('clients')
          .select('phone')
          .eq('phone', phone)
          .eq('status', 'active')
          .single();
        if (existingClient) {
          const { sendTemplate: st } = await import('../lib/whatsapp.js');
          const { escalateToMaddy: esc } = await import('../lib/escalation.js');
          await esc(phone, 'payment_failed', `Payment failed for active client`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programKey = product_id || checkout_id;
    const programInfo = PROGRAM_MAP[programKey] || { program: '12wk', weeks: 12 };

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone, name, status: 'converted' })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', lead.id);
    }

    // Create client
    const folderPath = `clients/${lead.id}`;
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: name || lead.name,
        email,
        program: programInfo.program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.init`, new Uint8Array([]), { upsert: true });

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${programInfo.program}`, [name || 'there'], true);

    // For 12-week program, trigger Week 1 generation immediately
    if (programInfo.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
