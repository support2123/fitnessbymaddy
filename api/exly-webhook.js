import crypto from 'crypto';
import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { PROGRAM_MAP } from '../lib/programs.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature && signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      event,
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_slug,
      product_name,
    } = req.body;

    if (event && event !== 'payment.success') {
      return res.status(200).json({ action: 'ignored', event });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    const programKey = resolveProgram(product_slug, product_name);
    const programDef = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];
    const weeks = programDef.weeks;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + weeks * 7);

    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: cleanPhone,
          name,
          source: 'exly_purchase',
          status: 'converted',
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: cleanPhone,
        name: name || lead.name,
        email,
        program: programKey,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : programDef.price * 100,
        checkout_id,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage.from('clients').upload(`${client.id}/.keep`, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true,
    });

    const templateName = `onboard_${programKey}`;
    await sendTemplate(cleanPhone, templateName, [
      name || 'there',
      programDef.name,
      `${weeks} weeks`,
    ]);

    if (programKey === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function resolveProgram(slug, productName) {
  if (slug) {
    for (const [key, def] of Object.entries(PROGRAM_MAP)) {
      if (def.exlySlug === slug) return key;
    }
  }

  if (productName) {
    const lower = productName.toLowerCase();
    if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
    if (lower.includes('pcos')) return 'pcos';
    if (lower.includes('40')) return '40plus';
    if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
    if (lower.includes('zoom') || lower.includes('1-on-1') || lower.includes('vip')) return 'zoom_pack';
    if (lower.includes('home')) return '6wk_home';
    if (lower.includes('shred') || lower.includes('6')) return '6wk_gym';
  }

  return '6wk_gym';
}
