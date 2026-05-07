import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { getProgramName } from '../lib/qualify.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: existingClient } = await supabase
          .from('clients')
          .select('phone')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .single();

        if (existingClient) {
          const { escalateToMaddy } = await import('../lib/escalation.js');
          await escalateToMaddy(
            customer_phone,
            'Payment failure for active client',
            `Amount: $${amount}, Checkout: ${checkout_id}`
          );
        }
      }
      return res.status(200).json({ status: 'skipped', reason: 'not_completed' });
    }

    const program = mapProductToProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    const leadId = lead?.id || null;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programWeeks = getProgramWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Blob(['']))
      .catch(() => {});

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(customer_phone, templateName, [
      customer_name || 'there',
      getProgramName(program)
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();

  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramWeeks(program) {
  const weeks = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return weeks[program] || 6;
}
