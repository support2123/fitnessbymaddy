const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES, cors, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const program = mapExlyProduct(product_name || product_id);
    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/[\s\-()]/g, '');

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .upsert({
        phone: normalizedPhone,
        lead_id: lead?.id || null,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (clientError) throw clientError;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('client-data')
      .upload(`${folderPath}.keep`, '', { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp({
      phone: normalizedPhone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there', PROGRAM_NAMES[program] || program]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 generation failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(normalizedPhone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productNameOrId) {
  if (!productNameOrId) return '6wk_gym';
  const lower = (productNameOrId + '').toLowerCase();
  if (/pcos/i.test(lower)) return 'pcos';
  if (/40\+|40plus|forty/i.test(lower)) return '40plus';
  if (/12|flagship|custom/i.test(lower)) return '12wk';
  if (/trial|zoom.*trial/i.test(lower)) return 'zoom_trial';
  if (/zoom.*pack/i.test(lower)) return 'zoom_pack';
  if (/home/i.test(lower)) return '6wk_home';
  return '6wk_gym';
}
