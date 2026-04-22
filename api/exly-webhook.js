const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { normalizePhone, cors, programWeeks, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, amount, checkout_id, product_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    const normalPhone = normalizePhone(phone);
    const program = mapProductToProgram(product_name || '');

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalPhone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const startDate = new Date();
    const weeks = programWeeks(program);
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalPhone)
      .maybeSingle();

    let clientId;
    if (existing) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        program,
        paid_amount: amount ? parseInt(amount * 100) : 0,
        checkout_id,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        status: 'active'
      }).eq('id', existing.id);
      clientId = existing.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({
        lead_id: lead?.id || null,
        phone: normalPhone,
        name,
        email,
        program,
        paid_amount: amount ? parseInt(amount * 100) : 0,
        checkout_id,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        status: 'active'
      }).select('id').single();
      clientId = newClient.id;
    }

    await supabase.from('clients').update({
      folder_url: `clients/${clientId}/`
    }).eq('id', clientId);

    await sendTemplate(normalPhone, `onboard_${program}`, [
      name || 'there',
      `${weeks} weeks`
    ], name || 'there');

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        console.error(`Week 1 program generation failed for ${maskPhone(normalPhone)}:`, genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
