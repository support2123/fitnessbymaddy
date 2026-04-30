const { supabase } = require('./_lib/supabase');
const { sendWhatsAppToClient } = require('./_lib/whatsapp');
const { PROGRAMS } = require('./_lib/constants');
const { escalateToMaddy } = require('./_lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      lead_id, phone, name, email, program,
      paid_amount, checkout_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let leadId = lead_id;

    if (!leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const programKey = program || '6wk_gym';
    const programInfo = PROGRAMS[programKey] || PROGRAMS['6wk_gym'];
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + programInfo.duration_weeks * 7);

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId || null,
        phone,
        name: name || null,
        email: email || null,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: paid_amount || programInfo.price,
        checkout_id: checkout_id || null,
        folder_url: `/clients/${crypto.randomUUID()}/`,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const welcomeMsg = `Welcome to ${programInfo.name}! Your program starts today. We'll send your first check-in form on Day 7. Let's do this!`;
    await sendWhatsAppToClient(phone, welcomeMsg, `onboard_${programKey}`);

    if (programKey === '12wk') {
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
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    await escalateToMaddy(req.body?.phone || 'unknown', 'payment_webhook_error', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
