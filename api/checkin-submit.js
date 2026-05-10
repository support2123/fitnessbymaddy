const { getSupabase } = require('../lib/supabase');
const { sendText, maskPhone } = require('../lib/whatsapp');
const { isEscalation } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body;

    if (!client_id || week_no === undefined) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Verify client exists and is active
    const { data: client, error: clientErr } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Prevent duplicate check-ins
    const { data: existing } = await db.from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    // Insert check-in
    const { data: checkin, error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }).select().single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check for escalation in issues
    if (issues && isEscalation(issues)) {
      await sendText('+917082478374',
        `🚨 Check-in alert — ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nIssue: ${issues}`
      );
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    // Acknowledge via WhatsApp
    const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';
    const ackMsg = market === 'IN'
      ? `✅ Week ${week_no} check-in received! Great job staying consistent. Aapka updated plan jaldi aayega 💪`
      : `✅ Week ${week_no} check-in received! Great job staying consistent. Your updated plan is on its way 💪`;

    await sendText(client.phone, ackMsg);

    await db.from('messages').insert({
      phone: client.phone,
      direction: 'out',
      body: ackMsg,
      template_name: 'checkin_ack',
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
      message: 'Check-in submitted successfully',
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
