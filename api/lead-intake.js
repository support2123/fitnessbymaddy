const { getSupabase } = require('./lib/supabase');
const { corsHeaders, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_schedule,
      medical_conditions, phone
    } = body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    // Find the lead
    let query = db.from('leads').select('*');
    if (lead_id) {
      query = query.eq('id', lead_id);
    } else {
      query = query.eq('phone', phone);
    }
    const { data: lead } = await query.single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with intake data
    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead.id);

    // Store detailed intake in a separate jsonb or as part of the client record later
    // For now, store as a message for audit trail
    const intakeData = JSON.stringify({
      name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_schedule,
      medical_conditions
    });

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[INTAKE FORM] ${intakeData}`,
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
