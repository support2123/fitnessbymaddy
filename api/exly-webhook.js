const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, getProgramEndDate } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      if (signature && signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, product, amount,
      checkout_id, order_id, status
    } = req.body;

    if (!phone || status !== 'completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = mapExlyProduct(product);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date().toISOString();
    const programEndDate = getProgramEndDate(program, now);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    let clientId;

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          program,
          paid_amount: amount ? parseInt(amount) : null,
          checkout_id: checkout_id || order_id,
          program_started_at: now,
          program_ends_at: programEndDate,
          status: 'active'
        })
        .eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client, error } = await supabase
        .from('clients')
        .insert({
          lead_id: lead?.id || null,
          phone: normalizedPhone,
          name: name || lead?.name || null,
          email: email || null,
          program,
          program_started_at: now,
          program_ends_at: programEndDate,
          paid_amount: amount ? parseInt(amount) : null,
          checkout_id: checkout_id || order_id,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        console.error(`Exly conversion error for ${maskPhone(normalizedPhone)}:`, error.message);
        return res.status(500).json({ error: 'Failed to create client' });
      }
      clientId = client.id;
    }

    await supabase.storage
      .from('clients')
      .upload(`${clientId}/.keep`, Buffer.from(''), { contentType: 'text/plain', upsert: true });

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', program.replace(/_/g, ' ')]
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Initial program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', `Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  let clean = phone.replace(/[\s\-()]/g, '');
  if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

function mapExlyProduct(product) {
  if (!product) return '6wk_gym';
  const lower = (product || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
