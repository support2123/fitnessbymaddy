const { supabase } = require('./_lib/supabase');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos,
    } = req.body || {};

    // Validate required fields
    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }
    if (week_no === undefined || week_no === null) {
      return res.status(400).json({ error: 'week_no is required' });
    }

    // Verify client exists
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, name')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Insert check-in record
    const { error: insertErr } = await supabase.from('checkins').insert({
      client_id,
      week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos || [],
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error('[checkin-submit] Insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    console.log(`[checkin-submit] Week ${week_no} check-in for client ${client_id}`);

    // Check issues for escalation keywords
    if (issues) {
      const issueText = typeof issues === 'string' ? issues : JSON.stringify(issues);
      const { flagged } = checkEscalation(issueText);
      if (flagged) {
        await notifyMaddy(
          'Escalation keyword in weekly check-in issues',
          client.phone,
          `Client: ${client.name}, Week ${week_no}, Issues: ${issueText}`
        );
        console.log(`[checkin-submit] Escalation triggered for client ${client_id} — issue keywords`);
      }
    }

    // Check for low compliance across 2 consecutive weeks
    if (compliance_score !== undefined && compliance_score !== null && compliance_score < 4) {
      // Look for the previous week's check-in
      const prevWeek = Number(week_no) - 1;
      if (prevWeek >= 1) {
        const { data: prevCheckin } = await supabase
          .from('checkins')
          .select('compliance_score')
          .eq('client_id', client_id)
          .eq('week_no', prevWeek)
          .single();

        if (prevCheckin && prevCheckin.compliance_score < 4) {
          await notifyMaddy(
            'Low compliance for 2 consecutive weeks',
            client.phone,
            `Client: ${client.name}, Weeks ${prevWeek}-${week_no}, Scores: ${prevCheckin.compliance_score} then ${compliance_score}`
          );
          console.log(`[checkin-submit] Low compliance escalation for client ${client_id}`);
        }
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in recorded!' });
  } catch (err) {
    console.error('[checkin-submit] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
