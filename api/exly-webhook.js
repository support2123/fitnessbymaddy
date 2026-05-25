const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { normalizePhone, programWeeks, maskPhone } = require('./_lib/helpers');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, program, amount,
      checkout_id, lead_id
    } = req.body;

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      resolvedLeadId = lead?.id || null;
    }

    if (resolvedLeadId) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', resolvedLeadId);
    }

    const weeks = programWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: resolvedLeadId,
        phone: normalizedPhone,
        name,
        email,
        program,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        program_ends_at: endsAt.toISOString(),
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [name || 'Champion'], true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
