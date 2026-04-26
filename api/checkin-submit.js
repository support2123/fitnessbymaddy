// api/checkin-submit.js — Weekly check-in form submission handler

const { supabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/utils');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

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
      photos_urls,
    } = req.body || {};

    // ── Validate required fields ────────────────────────────────────
    if (!client_id) {
      return res.status(400).json({ error: 'client_id is required' });
    }
    if (week_no === undefined || week_no === null) {
      return res.status(400).json({ error: 'week_no is required' });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: 'week_no must be a positive integer' });
    }

    // ── Verify client exists and is active ──────────────────────────
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const masked = maskPhone(client.phone);
    console.log(`[checkin] Week ${weekNum} check-in from client ${client.id} (${masked})`);

    // ── Insert check-in record ──────────────────────────────────────
    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: weekNum,
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photos_urls || null,
        form_submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      // Unique constraint — duplicate week submission
      if (insertErr.code === '23505') {
        return res.status(409).json({ error: 'Check-in for this week already submitted' });
      }
      console.error(`[checkin] Insert failed for ${masked}:`, insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // ── Escalation check on issues text ─────────────────────────────
    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation.shouldEscalate) {
        console.log(`[checkin] Escalation for ${masked}: ${escalation.reason}`);
        await notifyMaddy(
          `Check-in issue flag (week ${weekNum}): ${escalation.reason}`,
          {
            phone: client.phone,
            clientId: client.id,
            messageBody: issues,
          }
        );
      }
    }

    // ── Trigger program generation for 12-week clients ──────────────
    if (client.program === '12wk') {
      console.log(`[checkin] Triggering program generation for 12wk client ${client.id}, week ${weekNum}`);

      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      try {
        // Fire-and-forget — don't block the check-in response
        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY || '',
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: weekNum + 1, // Generate NEXT week's program
          }),
        }).catch((err) => {
          console.error(`[checkin] Program generation trigger failed for ${masked}:`, err.message);
        });
      } catch (err) {
        console.error(`[checkin] Program generation trigger error for ${masked}:`, err.message);
      }
    }

    // ── Send WhatsApp confirmation ──────────────────────────────────
    await sendText(
      client.phone,
      `Check-in received! Week ${weekNum} is locked in. Your updated program is on the way \u{1F4AA}`
    );

    console.log(`[checkin] Week ${weekNum} check-in saved: ${checkin.id}`);

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[checkin] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
