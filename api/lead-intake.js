const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, headers);
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      lead_id,
      age,
      gender,
      height_cm,
      current_weight,
      goal_weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      meals_per_day,
      workout_experience,
      days_available,
      equipment_access,
      wake_time,
      sleep_time,
    } = body;

    if (!lead_id) {
      res.writeHead(400, headers);
      return res.end(JSON.stringify({ error: 'lead_id is required' }));
    }

    const db = getSupabase();

    const medText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medText)) {
      const { data: lead } = await db
        .from('leads')
        .select('phone')
        .eq('id', lead_id)
        .single();
      await escalateToMaddy({
        reason: 'Medical flag in intake form',
        phone: lead?.phone || 'unknown',
        details: medText,
      });
    }

    const { data, error } = await db
      .from('intake_forms')
      .insert({
        lead_id,
        age: age ? parseInt(age) : null,
        gender,
        height_cm: height_cm ? parseFloat(height_cm) : null,
        current_weight: current_weight ? parseFloat(current_weight) : null,
        goal_weight: goal_weight ? parseFloat(goal_weight) : null,
        goal,
        injuries: injuries || null,
        medical_conditions: medical_conditions || null,
        diet_preference,
        meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
        workout_experience,
        days_available: days_available ? parseInt(days_available) : null,
        equipment_access,
        wake_time,
        sleep_time,
      })
      .select()
      .single();

    if (error) {
      res.writeHead(500, headers);
      return res.end(JSON.stringify({ error: 'Failed to save intake form' }));
    }

    res.writeHead(200, headers);
    return res.end(JSON.stringify({ ok: true, id: data.id }));
  } catch (err) {
    console.error('Intake error:', err.message);
    res.writeHead(500, headers);
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
