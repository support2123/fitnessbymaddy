const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { programWeeks, parseBody, corsHeaders } = require('../lib/helpers');
const { escalatePaymentFailure } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    const secret = req.headers['x-exly-secret'] || body.webhook_secret;
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, name, email, amount, checkout_id, program, status: paymentStatus } = body;

    if (paymentStatus === 'failed') {
      const { data: existingClient } = await supabase
        .from('clients').select('name, phone').eq('phone', phone).single();
      if (existingClient) {
        await escalatePaymentFailure(existingClient.name, phone);
      }
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const weeks = programWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads').select('id').eq('phone', phone).single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (error) {
      console.error('Client upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true
    });
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ action: 'client_onboarded', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
