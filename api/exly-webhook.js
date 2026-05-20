import crypto from 'crypto';
import { getSupabase } from './_lib/supabase.js';
import { sendTemplate, maskPhone } from './_lib/whatsapp.js';
import { getProgramWeeks } from './_lib/market.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, order_id
  } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'customer_phone is required' });
  }

  const db = getSupabase();

  try {
    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = mapProductToProgram(product_name || '');

    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        program_interest: program
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const weeks = getProgramWeeks(program);
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + weeks * 7);

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: customer_name || lead.name,
      email: customer_email,
      program,
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || order_id,
      folder_url: `/clients/${lead.id}/`,
      status: 'active'
    }).select().single();

    if (clientErr) throw clientErr;

    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${program} ($${amount || '?'})`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
