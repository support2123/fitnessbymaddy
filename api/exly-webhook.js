const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { PROGRAM_INFO, maskPhone } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || '';
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        console.error('[EXLY] Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
      status,
    } = req.body;

    if (status && status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const db = getSupabase();
        const { data: client } = await db
          .from('clients')
          .select('id')
          .eq('phone', phone)
          .eq('status', 'active')
          .limit(1)
          .single();

        if (client) {
          const { escalate: esc } = require('./_lib/escalation');
          await esc(phone, 'payment_failed', `Payment failed for ${product_name}`, client.id);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const program = detectProgramFromCheckout(checkout_id, product_name);
    const programInfo = PROGRAM_INFO[program] || PROGRAM_INFO['6wk_gym'];

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'exly_direct',
          status: 'converted',
          program_interest: program,
        })
        .select()
        .single();
      leadId = newLead?.id;
    } else {
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.duration_weeks * 7);

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id,
        status: 'active',
      })
      .select()
      .single();

    if (client) {
      const folderPath = `clients/${client.id}`;
      await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));

      await db
        .from('clients')
        .update({ folder_url: folderPath })
        .eq('id', client.id);
    }

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      programInfo.name,
      `${programInfo.duration_weeks} weeks`,
    ]);

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('[12WK INIT ERROR]', e.message);
      }
    }

    console.log(`[CONVERSION] ${maskPhone(phone)} → ${program} ($${amount || 0})`);
    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('[EXLY WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromCheckout(checkoutId, productName) {
  const id = (checkoutId || '').toLowerCase();
  const name = (productName || '').toLowerCase();

  if (id.includes('12wk') || name.includes('12 week') || name.includes('flagship')) return '12wk';
  if (id.includes('pcos') || name.includes('pcos')) return 'pcos';
  if (id.includes('40plus') || name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (id.includes('trial') || name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (id.includes('zoom-pack') || name.includes('zoom pack')) return 'zoom_pack';
  if (id.includes('home') || name.includes('home')) return '6wk_home';
  return '6wk_gym';
}
