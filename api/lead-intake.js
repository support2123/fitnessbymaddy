const { getSupabase } = require('../lib/supabase');
const { json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_activity,
      medical_conditions,
      photos,
    } = req.body;

    if (!lead_id) return json(res, { error: 'Missing lead_id' }, 400);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return json(res, { error: 'Lead not found' }, 404);

    // Update lead with name/email if provided
    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    // Store intake data on the client record if they've already converted,
    // otherwise store it as a pending intake on leads
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_activity,
      medical_conditions,
      photos,
      submitted_at: new Date().toISOString(),
    };

    if (client) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        intake_data: intakeData,
      }).eq('id', client.id);
    } else {
      // Store on lead as JSON for later migration to client
      await db.from('leads').update({
        name: name || lead.name,
      }).eq('id', lead_id);
    }

    // Check for escalation triggers in medical conditions / injuries
    const escalationTerms = ['pregnant', 'pregnancy', 'heart', 'surgery', 'diabetes', 'medication'];
    const combined = `${injuries || ''} ${medical_conditions || ''}`.toLowerCase();
    const needsEscalation = escalationTerms.some(t => combined.includes(t));

    if (needsEscalation) {
      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(`Intake form flagged — ${name || 'Unknown'} reported: ${combined.slice(0, 120)}`);
    }

    return json(res, { ok: true, escalated: needsEscalation });
  } catch (err) {
    console.error('Intake error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
