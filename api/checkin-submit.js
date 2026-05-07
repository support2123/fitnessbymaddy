const { supabase } = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
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

    // --- Validation ---
    if (!client_id || week_no == null) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const weekNum = parseInt(week_no, 10);
    if (isNaN(weekNum) || weekNum < 1) {
      return res.status(400).json({ error: 'week_no must be a positive integer' });
    }

    if (compliance_score != null && (compliance_score < 1 || compliance_score > 10)) {
      return res.status(400).json({ error: 'compliance_score must be between 1 and 10' });
    }

    if (energy != null && (energy < 1 || energy > 10)) {
      return res.status(400).json({ error: 'energy must be between 1 and 10' });
    }

    if (photos != null && !Array.isArray(photos)) {
      return res.status(400).json({ error: 'photos must be an array of URLs' });
    }

    // --- Check client exists and is active ---
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name, phone, status, program_type')
      .eq('id', client_id)
      .maybeSingle();

    if (clientErr) {
      console.error('Client lookup failed:', clientErr.message);
      return res.status(500).json({ error: 'Failed to verify client' });
    }

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(403).json({ error: 'Client is not active' });
    }

    // --- Prevent duplicate submission ---
    const { data: existing, error: dupErr } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .maybeSingle();

    if (dupErr) {
      console.error('Duplicate check failed:', dupErr.message);
      return res.status(500).json({ error: 'Failed to check for duplicates' });
    }

    if (existing) {
      return res.status(409).json({ error: `Check-in already submitted for week ${weekNum}` });
    }

    // --- Insert check-in ---
    const checkinRow = {
      client_id,
      week_no: weekNum,
      weight: weight != null ? parseFloat(weight) : null,
      waist: waist != null ? parseFloat(waist) : null,
      compliance_score: compliance_score != null ? parseInt(compliance_score, 10) : null,
      energy: energy != null ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos: photos || null,
      submitted_at: new Date().toISOString(),
    };

    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .insert(checkinRow)
      .select('id')
      .single();

    if (insertErr) {
      console.error('Check-in insert failed:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // --- Trigger program generation for 12-week program clients ---
    if (client.program_type === '12_week') {
      try {
        const { generateProgram } = require('./generate-program');
        // Fire and forget -- don't block the check-in response
        generateProgram(client_id, weekNum + 1).catch((err) => {
          console.error(
            `Program generation failed for client ${maskPhone(client.phone || '')} week ${weekNum + 1}:`,
            err.message
          );
        });
      } catch (importErr) {
        console.error('Failed to import generate-program module:', importErr.message);
      }
    }

    // --- Send WhatsApp confirmation ---
    if (client.phone) {
      try {
        await sendTemplate(client.phone, 'checkin_confirmation', {
          userName: client.name || client.phone,
          templateParams: [
            client.name || 'there',
            String(weekNum),
          ],
        });
      } catch (whatsappErr) {
        // Non-blocking -- check-in is already saved
        console.error(
          `WhatsApp confirmation failed for ${maskPhone(client.phone)}:`,
          whatsappErr.message
        );
      }
    }

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
      message: `Check-in received for Week ${weekNum}! Your updated program will be ready within 24 hours.`,
    });
  } catch (err) {
    console.error('Checkin submission error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
