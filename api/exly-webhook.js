import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { escalateToMaddy } from '../lib/escalation.js';
import { maskPhone, cors, parseBody } from '../lib/helpers.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const phone = body.phone || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const checkoutId = body.checkout_id || body.order_id;
    const productName = body.product_name || body.item || '';
    const amount = body.amount || body.paid_amount;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = mapProductToProgram(productName);

    const { data: lead } = await supabase
      .from('leads').select('id')
      .eq('phone', phone).single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programEnd = new Date();
    if (program === '12wk') programEnd.setDate(programEnd.getDate() + 84);
    else if (program.startsWith('6wk')) programEnd.setDate(programEnd.getDate() + 42);
    else programEnd.setDate(programEnd.getDate() + 30);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkoutId,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client create error:', error.message);
      await escalateToMaddy('Payment received but client creation failed', {
        phone, details: error.message
      });
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      program === '12wk' ? '12-Week Custom' : program
    ]);

    console.log(`New client created: ${maskPhone(phone)} → ${program}`);
    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (/12.?week|custom|flagship/.test(lower)) return '12wk';
  if (/pcos/.test(lower)) return 'pcos';
  if (/40\+|40 plus|forty/.test(lower)) return '40plus';
  if (/home/.test(lower)) return '6wk_home';
  if (/zoom.*pack|session.*pack/.test(lower)) return 'zoom_pack';
  if (/zoom|trial/.test(lower)) return 'zoom_trial';
  return '6wk_gym';
}
