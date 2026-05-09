import Anthropic from '@anthropic-ai/sdk';
import supabase from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { escalateToMaddy } from '../lib/escalation.js';
import { maskPhone, cors, parseBody } from '../lib/helpers.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'below 1000 calories', 'below 800',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in 2 weeks',
  'starvation', 'very low calorie'
];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins').select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs').select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach creating weekly training and nutrition plans.

RULES:
- Create evidence-based, safe programs
- Never prescribe calories below 1200 for women or 1500 for men
- Never suggest banned substances or supplements without medical backing
- Progressive overload principles
- Account for client's reported issues, injuries, and energy levels
- Output valid JSON only

OUTPUT FORMAT:
{
  "workout_plan": {
    "days": [
      { "day": "Monday", "focus": "...", "exercises": [{ "name": "...", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }] }
    ],
    "rest_days": ["Sunday"],
    "cardio": "..."
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meal_framework": [
      { "meal": "Breakfast", "suggestion": "..." }
    ],
    "notes": "..."
  },
  "coach_notes": "..."
}`;

    const userPrompt = buildUserPrompt(client, recentCheckins, lastProgram, week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawOutput = response.content[0].text;

    const safetyCheck = SAFETY_FLAGS.some(flag =>
      rawOutput.toLowerCase().includes(flag)
    );

    if (safetyCheck) {
      await escalateToMaddy('Program flagged for safety review', {
        phone: client.phone,
        name: client.name,
        details: `Week ${week_no} program contained flagged content`
      });
      return res.json({ ok: false, reason: 'flagged_for_review' });
    }

    let parsed;
    try {
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch {
      console.error('Failed to parse Claude output as JSON');
      return res.status(500).json({ error: 'Invalid program output' });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.coach_notes || null,
      pdf_url: null
    }).select().single();

    if (error) {
      console.error('Program insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save program' });
    }

    await sendWhatsApp(client.phone, 'weekly_program', [
      client.name || 'there',
      `Week ${week_no}`,
      parsed.coach_notes || 'Your new program is ready!'
    ]);

    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    console.log(`Program generated: ${maskPhone(client.phone)} week ${week_no}`);
    return res.json({ ok: true, program_id: program.id });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function buildUserPrompt(client, checkins, lastProgram, weekNo) {
  let prompt = `Generate Week ${weekNo} program for this client:\n\n`;
  prompt += `Name: ${client.name || 'Unknown'}\n`;
  prompt += `Program: ${client.program}\n`;
  prompt += `Started: ${client.program_started_at}\n\n`;

  if (checkins && checkins.length > 0) {
    prompt += `Recent check-ins:\n`;
    for (const c of checkins) {
      prompt += `- Week ${c.week_no}: weight=${c.weight}kg, waist=${c.waist}cm, `;
      prompt += `compliance=${c.compliance_score}/10, energy=${c.energy}/10`;
      if (c.issues) prompt += `, issues: ${c.issues}`;
      prompt += `\n`;
    }
    prompt += `\n`;
  }

  if (lastProgram) {
    prompt += `Last week's focus: ${lastProgram.notes || 'Standard progression'}\n`;
    if (lastProgram.nutrition_plan) {
      prompt += `Last calories: ${lastProgram.nutrition_plan.calories || 'not set'}\n`;
    }
  }

  prompt += `\nDesign an appropriate Week ${weekNo} plan with progressive adjustments.`;
  return prompt;
}
