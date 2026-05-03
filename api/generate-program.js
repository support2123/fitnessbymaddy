import Anthropic from '@anthropic-ai/sdk';
import supabase from './_lib/supabase.js';
import { sendTemplate } from './_lib/whatsapp.js';
import { maskPhone, jsonResponse, parseBody } from './_lib/helpers.js';

const UNSAFE_PATTERNS = [
  /under\s*800\s*cal/i,
  /starvation/i,
  /clenbuterol/i,
  /dnp/i,
  /ephedra/i,
  /steroids?\b/i,
  /sarms?\b/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*(in|per)\s*(a\s*)?week/i,
];

function isSafeProgram(text) {
  return !UNSAFE_PATTERNS.some(p => p.test(text));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

    const { data: lead } = await supabase
      .from('leads')
      .select('first_msg')
      .eq('id', client.lead_id)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    let intakeInfo = '';
    try {
      const parsed = JSON.parse(lead?.first_msg || '{}');
      intakeInfo = Object.entries(parsed)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    } catch {
      intakeInfo = lead?.first_msg || 'No intake data';
    }

    const checkinSummary = (recentCheckins || [])
      .map(c =>
        `Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, ` +
        `compliance=${c.compliance_score}/10, energy=${c.energy}/10, ` +
        `issues=${c.issues || 'none'}`
      )
      .join('\n');

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a certified fitness program architect for FitnessByMaddy.
Generate Week ${week_no} program for this client.

CLIENT PROFILE:
Name: ${client.name}
Program: ${client.program}
${intakeInfo}

RECENT CHECK-INS:
${checkinSummary || 'No check-ins yet (Week 1)'}

PREVIOUS PROGRAM NOTES:
${lastProgram?.notes || 'First week - no prior program'}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown:
{
  "workout_plan": {
    "focus": "string — this week's training focus",
    "days": [
      {
        "day": "Monday",
        "type": "Upper Body / Lower Body / Full Body / Rest / Cardio",
        "exercises": [
          { "name": "Exercise Name", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "daily_calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fat_g": 70,
    "meal_timing": ["meal 1 description", "meal 2 description"],
    "notes": "any dietary adjustments this week"
  },
  "coach_note": "1-2 sentence personalized note from coach to client"
}

RULES:
- Base on client data and progressive overload from prior weeks
- Never prescribe under 1200 calories for women or 1500 for men
- No banned substances or extreme protocols
- Keep it realistic, science-backed, and motivating
- Adjust based on compliance score and reported issues`,
      }],
    });

    const responseText = message.content[0].text;

    if (!isSafeProgram(responseText)) {
      console.error(`UNSAFE program flagged for client ${maskPhone(client.phone)}`);
      await sendTemplate(process.env.MADDY_PHONE || client.phone, 'escalation_alert', [
        maskPhone(client.phone),
        `Week ${week_no} program flagged for safety review`,
      ]);
      return jsonResponse(res, 400, { error: 'Program flagged for safety review' });
    }

    let programData;
    try {
      programData = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        programData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    const { data: program, error } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: programData.coach_note,
      })
      .select()
      .single();

    if (error) {
      console.error('Program save error:', error.message);
      return jsonResponse(res, 500, { error: 'Failed to save program' });
    }

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      programData.coach_note || 'Your new program is ready!',
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} Week ${week_no}`);

    return jsonResponse(res, 200, {
      success: true,
      program_id: program.id,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
