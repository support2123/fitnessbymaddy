const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, programWeeks } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const rawBody = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name) || '6wk_gym';
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || null,
        checkout_id: checkout_id || product_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('[exly] Client insert error:', error.message);
      return res.status(500).json({ error: 'DB error' });
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
    await sendTemplate(phone, templateName, [
      client.name || 'there',
      weeks.toString(),
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1,
          }),
        });
      } catch (genErr) {
        console.error('[exly] Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('[exly-webhook] Error:', err.message);
    await notifyMaddy(
      'Payment webhook error',
      `Error: ${err.message}\nPhone: ${maskPhone(req.body?.phone || 'unknown')}`
    );
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return null;
}
