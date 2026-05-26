const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/masking');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const db = getSupabase();
        const { data: client } = await db
          .from('clients')
          .select('phone')
          .eq('phone', normalizePhone(customer_phone))
          .eq('status', 'active')
          .single();

        if (client) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(
            'Payment failure for active client',
            client.phone,
            `Checkout ${checkout_id}, amount ${amount}`
          );
        }
      }
      return res.status(200).json({ status: 'ignored', reason: `status=${status}` });
    }

    const phone = normalizePhone(customer_phone);
    const db = getSupabase();

    const program = mapProductToProgram(product_name);
    const programDuration = getProgramDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const { data: newClient, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name || null,
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${newClient.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', newClient.id);

    const welcomeMsg =
      `Welcome to the ${getProgramLabel(program)} program! 🎉\n\n` +
      `Your journey starts today. Here's what happens next:\n` +
      `1. Complete your intake form if you haven't yet\n` +
      `2. Your first check-in will be on Day 7\n` +
      `3. You'll receive your customized plan shortly\n\n` +
      `Let's make this transformation happen! 💪`;

    await sendWhatsApp(phone, welcomeMsg, `onboard_${program}`, true);

    console.log(`Conversion: ${maskPhone(phone)} → ${program} client=${newClient.id}`);
    return res.status(200).json({ status: 'ok', client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
}

function mapProductToProgram(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6 week')) return '6wk_gym';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return 'zoom_trial';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

function getProgramLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}
