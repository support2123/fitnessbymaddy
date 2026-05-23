const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { getProgramDurationWeeks, parseBody, corsHeaders } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const {
    checkout_id, phone, name, email,
    product_name, amount, status: paymentStatus
  } = body;

  if (paymentStatus === 'failed') {
    await notifyMaddy('Payment failed for lead', {
      phone,
      clientName: name,
      details: `Product: ${product_name}, Amount: ${amount}`
    });
    return res.status(200).json({ action: 'payment_failed_notified' });
  }

  if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
    return res.status(200).json({ action: 'ignored', status: paymentStatus });
  }

  const db = getSupabase();
  const program = mapProductToProgram(product_name);
  const durationWeeks = getProgramDurationWeeks(program);
  const programEnds = new Date();
  programEnds.setDate(programEnds.getDate() + durationWeeks * 7);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name,
    email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEnds.toISOString(),
    paid_amount: amount,
    checkout_id,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('Client creation failed:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}/`;
  await db.storage.from('clients').upload(`${client.id}/.keep`, new Uint8Array(0), {
    contentType: 'application/octet-stream',
    upsert: true
  });

  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${program}`, [name || 'there']);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week 1 program generation failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};

function mapProductToProgram(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();

  if (/pcos/.test(lower)) return 'pcos';
  if (/40\+|40 plus|forty/.test(lower)) return '40plus';
  if (/12.?week|custom|flagship/.test(lower)) return '12wk';
  if (/home/.test(lower)) return '6wk_home';
  if (/6.?week|shred|burn/.test(lower)) return '6wk_gym';
  if (/zoom.*pack/.test(lower)) return 'zoom_pack';
  if (/zoom|trial/.test(lower)) return 'zoom_trial';

  return 'zoom_trial';
}
