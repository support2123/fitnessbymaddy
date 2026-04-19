const { supabase } = require('../lib/supabase');
const { jsonResponse, handleCors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_pref, schedule, program
    } = req.body;

    if (!lead_id) return jsonResponse(res, { error: 'lead_id required' }, 400);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return jsonResponse(res, { error: 'Lead not found' }, 404);

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const selectedProgram = program || lead.program_interest;

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || lead.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        program: selectedProgram,
      }).eq('id', existingClient.id);

      return jsonResponse(res, { success: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      program: selectedProgram,
      status: 'active',
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return jsonResponse(res, { error: 'Failed to save' }, 500);
    }

    return jsonResponse(res, { success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
