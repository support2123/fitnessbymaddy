import supabase from './lib/supabase.js';
import { sendTemplate, sendToMaddy } from './lib/whatsapp.js';
import { maskPhone, PROGRAM_INFO } from './lib/utils.js';
import crypto from 'crypto';

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (/6.*week.*home/i.test(lower)) return '6wk_home';
  if (/6.*week|shred|burn/i.test(lower)) return '6wk_gym';
  if (/12.*week|custom|flagship/i.test(lower)) return '12wk';
  if (/pcos/i.test(lower)) return 'pcos';
  if (/40\+|forty|strong/i.test(lower)) return '40plus';
  if (/zoom.*pack/i.test(lower)) return 'zoom_pack';
  if (/trial|zoom/i.test(lower)) return 'zoom_trial';
  return '6wk_gym';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, order_id,
    } = req.body;

    const phone = (customer_phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const program = mapExlyProduct(product_name);
    const info = PROGRAM_INFO[program];
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + (info.weeks * 7));

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
      }).select().single();
      lead = newLead;
    } else {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create client record
    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || order_id,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('client-files').upload(folderPath, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true,
    });

    await supabase.from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding WhatsApp template
    await sendTemplate(
      phone,
      `onboard_${program}`,
      [customer_name || 'there', info.name, `${info.weeks} weeks`],
      customer_name
    );

    // Notify Maddy of new conversion
    await sendToMaddy(
      `💰 NEW CONVERSION!\nClient: ${customer_name || maskPhone(phone)}\nProgram: ${info.name}\nAmount: $${amount || info.price}\nPhone: ${maskPhone(phone)}`
    );

    // For 12-week program, trigger Week 1 program generation
    if (program === '12wk') {
      const origin = `https://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
