const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { PROGRAM_DETAILS, cors, parseBody } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
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

    const {
      phone, email, name, amount, checkout_id, product_name,
      status: paymentStatus,
    } = body;

    if (paymentStatus === 'failed') {
      await escalateToMaddy('Payment failed', { phone, name, extra: `Amount: ${amount}` });
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const program = detectProgramFromProduct(product_name) || '6wk_gym';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const programEnds = calculateEndDate(program);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: '',
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const details = PROGRAM_DETAILS[program] || { name: product_name || 'Your Program' };
    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      details.name,
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.SITE_URL || 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week 1 program gen failed:', err.message));
    }

    return res.status(200).json({ action: 'client_created', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return null;
}

function calculateEndDate(program) {
  const weeks = program === '12wk' ? 12 : program.startsWith('zoom') ? 4 : 6;
  const end = new Date();
  end.setDate(end.getDate() + weeks * 7);
  return end.toISOString();
}
