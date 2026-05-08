const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { PROGRAM_MAP } = require('../lib/keywords');
const { maskPhone } = require('../lib/mask-phone');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const {
      phone, email, name, product_id, product_name,
      amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await notifyMaddy(
          'Payment failed',
          `Phone: ${maskPhone(phone)}\nProduct: ${product_name}\nAmount: $${amount}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const db = getSupabase();

    const normalizedPhone = normalizePhone(phone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = detectProgram(product_name, amount);
    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone: normalizedPhone,
      name: name || (lead && lead.name),
      email,
      program,
      paid_amount: amount,
      checkout_id,
      program_ends_at: endsAt.toISOString(),
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true
    });

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplate(normalizedPhone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', PROGRAM_MAP[program]?.name || product_name]
    });

    return res.status(200).json({
      action: 'converted',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function detectProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (amount && amount >= 150) return '12wk';
  return '6wk_gym';
}
