const {
  supabaseFetch,
  maskPhone,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

const REQUIRED_FIELDS = ['name', 'phone', 'age', 'goal'];

/**
 * POST /api/lead-intake
 * Intake form submission for lead qualification
 * Fields: lead_id, name, age, goal, injuries, diet_pref, schedule, phone, email
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
      email,
    } = req.body;

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter(field => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing,
      });
    }

    // Validate age is a number
    if (isNaN(Number(age)) || Number(age) < 10 || Number(age) > 100) {
      return res.status(400).json({ error: 'Invalid age. Must be between 10 and 100.' });
    }

    // Build update payload
    const updateData = {
      name,
      age: Number(age),
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      email: email || null,
      status: 'intake_complete',
      intake_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Determine update path: by lead_id or by phone
    let path;
    if (lead_id) {
      path = `/leads?id=eq.${encodeURIComponent(lead_id)}`;
    } else if (phone) {
      path = `/leads?phone=eq.${encodeURIComponent(phone)}`;
    } else {
      return res.status(400).json({ error: 'lead_id or phone is required to identify the lead' });
    }

    const result = await supabaseFetch(path, {
      method: 'PATCH',
      body: updateData,
    });

    if (!result || result.length === 0) {
      // Lead doesn't exist yet, create it
      const newLead = {
        phone,
        ...updateData,
        source: 'intake_form',
        created_at: new Date().toISOString(),
      };

      const created = await supabaseFetch('/leads', {
        method: 'POST',
        body: newLead,
      });

      console.log(`New lead created via intake: ${maskPhone(phone)}`);
      return res.status(201).json({ success: true, lead: created[0] || null });
    }

    console.log(`Lead intake updated: ${maskPhone(phone)}`);
    return res.status(200).json({ success: true, lead: result[0] || null });
  } catch (error) {
    console.error('lead-intake error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
