const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { getProgramName, detectMarket } = require('./_lib/helpers');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      phone, name, email, program, amount,
      checkout_id, status: paymentStatus
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    if (paymentStatus === 'failed') {
      await escalateToMaddy({
        reason: 'Payment failure',
        phone,
        clientName: name,
        details: `Program: ${program}, Amount: $${amount || '?'}`
      });
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted', last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : 0,
        checkout_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';
    const programName = getProgramName(program);

    const onboardMsg = isHinglish
      ? `Welcome to ${programName}! Tumhara journey ab shuru hota hai. Week 1 ka check-in form Sunday ko aayega. Let's crush this!`
      : `Welcome to ${programName}! Your journey starts now. Your Week 1 check-in form will arrive on Sunday. Let's crush this!`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: onboardMsg,
      params: [name || 'Champion', programName]
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programName
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
