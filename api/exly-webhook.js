const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { createEscalation } = require('./_lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, name, email, program, amount, checkout_id, signature } = req.body;

    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(checkout_id || '')
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const cleanPhone = phone.replace(/\+/g, '');

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone: cleanPhone,
        name,
        source: 'exly',
        status: 'converted',
        program_interest: program,
        market: 'GLOBAL'
      }).select('id').single();
      lead = newLead;
    } else {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Check for existing active client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.json({ ok: true, message: 'Client already active', client_id: existingClient[0].id });
    }

    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone: cleanPhone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select('id').single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Database error' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('client-files')
      .upload(folderPath, new Uint8Array(0), { upsert: true });

    await supabase.from('clients').update({
      folder_url: `clients/${client.id}/`
    }).eq('id', client.id);

    // Send onboarding WhatsApp
    await sendWhatsApp({
      phone: cleanPhone,
      templateName: `onboard_${program}`,
      body: `Welcome to FitnessByMaddy! 🎉 Your ${program} program starts now. Check your WhatsApp for your first plan and check-in form in 7 days.`,
      params: [name || 'Champion']
    });

    // For 12-week program: trigger Week 1 generation immediately
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body?.phone) {
      await createEscalation({
        sourceType: 'lead',
        sourceId: null,
        phone: req.body.phone,
        reason: 'Payment processing error',
        messageBody: err.message
      }).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
