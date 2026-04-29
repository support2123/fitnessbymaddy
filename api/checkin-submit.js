const { supabase } = require('./_lib/supabase');
const { sendText, maskPhone } = require('./_lib/whatsapp');
const { MADDY_PHONE } = require('./_lib/constants');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

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

    // Validate required fields
    if (!client_id || week_no === undefined || week_no === null) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['client_id', 'week_no'],
      });
    }

    // Look up client to get phone and program info
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, phone, program, name')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      console.error(`Client lookup failed for ${client_id}:`, clientError?.message);
      return res.status(404).json({ error: 'Client not found' });
    }

    // Insert check-in record
    const { error: insertError } = await supabase.from('checkins').insert({
      client_id,
      week_no,
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos_urls || null,
      created_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error(
        `Failed to insert checkin for client ${client_id}:`,
        insertError.message
      );
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Check for 2 consecutive missed check-ins before this one
    const prevWeek1 = week_no - 2;
    const prevWeek2 = week_no - 1;

    if (prevWeek1 >= 1) {
      const { data: prevCheckins, error: prevError } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client_id)
        .in('week_no', [prevWeek1, prevWeek2]);

      if (!prevError && prevCheckins) {
        const submittedWeeks = prevCheckins.map((c) => c.week_no);
        const missedBoth =
          !submittedWeeks.includes(prevWeek1) && !submittedWeeks.includes(prevWeek2);

        if (missedBoth) {
          // Escalate: 2 consecutive missed check-ins detected
          await supabase.from('escalations').insert({
            phone: client.phone,
            message: `Client ${client.name || client_id} submitted week ${week_no} but missed weeks ${prevWeek1} and ${prevWeek2}`,
            reason: 'consecutive_missed_checkins',
            created_at: new Date().toISOString(),
          });

          await sendText(
            MADDY_PHONE,
            `Alert: Client ${client.name || maskPhone(client.phone)} missed check-ins for weeks ${prevWeek1} and ${prevWeek2}. They just submitted week ${week_no}.`
          );
        }
      }
    }

    // If 12wk program, flag for program generation
    if (client.program === '12wk') {
      console.log(
        `Program generation needed: client=${client_id}, week=${week_no}, program=12wk`
      );

      // Log the generation request for async processing
      await supabase.from('program_generation_queue').insert({
        client_id,
        week_no,
        status: 'pending',
        created_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) {
          // Table may not exist yet; log but don't fail
          console.warn('program_generation_queue insert skipped:', error.message);
        }
      });
    }

    // Send acknowledgment to client
    await sendText(
      client.phone,
      `Check-in received! Your Week ${week_no} program is being prepared.`
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('checkin-submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
