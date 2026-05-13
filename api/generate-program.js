import Anthropic from '@anthropic-ai/sdk';
import supabase from './lib/supabase.js';
import { sendTemplate } from './lib/whatsapp.js';
import { isHinglish, detectMarket } from './lib/market.js';

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SAFETY_FLAGS = [
  'below 1000 calories', 'under 800 calories', 'extreme deficit',
  'clenbuterol', 'dnp', 'ephedra', 'anabolic', 'steroid',
  'lose 10kg in 1 week', 'lose 20 pounds in a week'
];

function checkSafety(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.filter(flag => lower.includes(flag));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intake } = await supabase
      .from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      goal: intake?.goal || 'general fitness',
      age: intake?.age,
      gender: intake?.gender,
      injuries: intake?.injuries || 'none reported',
      diet_preference: intake?.diet_preference || 'no preference',
      experience: intake?.experience_level || 'intermediate',
      schedule: intake?.schedule || '5 days/week',
      recentCheckins: (recentCheckins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      }))
    };

    const systemPrompt = `You are Maddy's program architect — an expert fitness coach creating personalised weekly training and nutrition plans.

RULES:
- Create safe, evidence-based programs only
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances or extreme protocols
- Account for injuries and medical conditions
- Progressive overload week-to-week
- Adjust based on check-in feedback (compliance, energy, issues)

OUTPUT FORMAT: Return valid JSON only with this structure:
{
  "workout_plan": {
    "summary": "Brief overview of the week's focus",
    "days": [
      { "day": "Monday", "focus": "Upper Body", "exercises": [
        { "name": "Exercise Name", "sets": 3, "reps": "8-12", "rest": "60s", "notes": "" }
      ]},
      ...
    ],
    "cardio": "Cardio prescription for the week",
    "recovery": "Recovery/rest day guidance"
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein_g": 150,
    "carbs_g": 200,
    "fats_g": 70,
    "meal_timing": "Meal timing guidance",
    "sample_meals": [
      { "meal": "Breakfast", "options": ["Option 1", "Option 2"] },
      ...
    ],
    "supplements": ["Only evidence-based supplements"],
    "hydration": "Water intake guidance"
  },
  "coach_notes": "Personalised note from Maddy to the client for this week"
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const fullText = JSON.stringify(programData);
    const safetyIssues = checkSafety(fullText);

    if (safetyIssues.length > 0) {
      console.error(`Safety flag for client ${client_id}:`, safetyIssues);
      const { sendTemplate: sendEsc } = await import('./lib/escalation.js');
      const { escalateToMaddy } = await import('./lib/escalation.js');
      await escalateToMaddy(
        `Safety flag in generated program: ${safetyIssues.join(', ')}`,
        client.phone,
        `Week ${week_no} program flagged. Issues: ${safetyIssues.join(', ')}`
      );
      return res.status(422).json({ error: 'Program flagged for review', flags: safetyIssues });
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.coach_notes || '',
      generated_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const weekMsg = hinglish
      ? [`Week ${week_no} ka plan ready hai! 💪\n\n${programData.coach_notes || 'Let\'s crush it this week!'}`]
      : [`Your Week ${week_no} plan is ready! 💪\n\n${programData.coach_notes || 'Let\'s crush it this week!'}`];

    await sendTemplate(client.phone, 'weekly_program', weekMsg, true);

    return res.json({ success: true, programId: program.id });
  } catch (err) {
    console.error('Program generation error:', err);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
}
