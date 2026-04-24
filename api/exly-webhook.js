const crypto = require('crypto');
const supabase = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return sig === expected;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone,
      email,
      name,
      product_name,
      amount,
      checkout_id,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('*')
          .eq('phone', phone)
          .single();

        if (lead) {
          await notifyMaddy(
            'Payment Failed',
            `Lead: ${name} (${maskPhone(phone)})\nProduct: ${product_name}\nCheckout: ${checkout_id}`
          );
        }
      }
      return res.status(200).json({ action: 'non_completed_payment' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true,
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', durationDays.toString()],
    });

    if (program === '12wk') {
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
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  return '6wk_gym';
}
