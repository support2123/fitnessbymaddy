import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from './_lib/supabase.js';
import { generateProgramHTML } from './_lib/pdf.js';
import { sendClientMessage } from './_lib/whatsapp.js';
import { escalateToMaddy } from './_lib/escalate.js';

const UNSAFE_PATTERNS = [
  /under\s*1[0-2]00\s*cal/i,
  /starvation/i,
  /clenbuterol|dnp|ephedra|sarm/i,
  /lose\s*\d{2,}\s*kg\s*in\s*\d\s*week/i
];

function auditProgramSafety(workout, nutrition) {
  const fullText = JSON.stringify(workout) + JSON.stringify(nutrition);
  for (const pat of UNSAFE_PATTERNS) {
    if (pat.test(fullText)) return pat.source;
  }
  if (nutrition.calories && parseInt(nutrition.calories) < 1200) {
    return 'calories_too_low';
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: intakeForm } = await db.from('intake_forms')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentCheckins } = await db.from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await db.from('programs')
      .select('workout_plan, nutrition_plan')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified personal trainer and nutrition coach working for Fitness by Maddy.
Generate a weekly training + nutrition program as JSON.

RULES:
- Evidence-based only. No bro-science.
- Minimum 1200 calories for women, 1500 for men.
- Never recommend banned substances, extreme protocols, or unrealistic timelines.
- Progressive overload from previous weeks when data is available.
- Consider injuries, medical conditions, and dietary preferences from the intake form.
- If the client reported pain or injury in check-ins, reduce load on affected area.

OUTPUT FORMAT (JSON only, no markdown):
{
  "workout": {
    "focus": "string describing this week's training focus",
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ],
    "notes": "optional coach notes on training"
  },
  "nutrition": {
    "calories": "2200",
    "protein": "180",
    "carbs": "220",
    "fat": "70",
    "meals": [
      { "name": "Meal 1", "description": "Oats with whey and banana" }
    ],
    "notes": "optional nutrition notes"
  },
  "coach_notes": "optional motivational/strategic notes for the client"
}`;

    const userPrompt = `Generate Week ${week_no} program for:

CLIENT PROFILE:
- Name: ${client.name}
- Program: ${client.program}
- Started: ${client.program_started_at}

${intakeForm ? `INTAKE FORM:
- Age: ${intakeForm.age || 'N/A'}
- Gender: ${intakeForm.gender || 'N/A'}
- Goal: ${intakeForm.goal || 'N/A'}
- Experience: ${intakeForm.experience || 'N/A'}
- Injuries: ${intakeForm.injuries || 'None reported'}
- Diet preference: ${intakeForm.diet_pref || 'No preference'}
- Schedule: ${intakeForm.schedule || 'N/A'}
- Current weight: ${intakeForm.current_weight || 'N/A'}kg
- Target weight: ${intakeForm.target_weight || 'N/A'}kg
- Height: ${intakeForm.height || 'N/A'}
- Medical: ${intakeForm.medical_conditions || 'None reported'}` : 'No intake form available.'}

${recentCheckins && recentCheckins.length > 0 ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight || 'N/A'}kg, Waist ${c.waist || 'N/A'}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10${c.issues ? `, Issues: ${c.issues}` : ''}`).join('\n')}` : 'No check-in data yet (first week).'}

${lastProgram ? `LAST WEEK'S PROGRAM SUMMARY:
Workout: ${JSON.stringify(lastProgram.workout_plan).slice(0, 500)}
Nutrition: Calories ${lastProgram.nutrition_plan?.calories || 'N/A'}` : 'No previous program (generating first week).'}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const rawText = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    const { workout, nutrition, coach_notes } = parsed;

    const safetyIssue = auditProgramSafety(workout, nutrition);
    if (safetyIssue) {
      await escalateToMaddy('Unsafe program flagged', {
        clientName: client.name,
        phone: client.phone,
        message: `Week ${week_no} program flagged: ${safetyIssue}`,
        extra: `Client ID: ${client_id}`
      });
      return res.status(200).json({ ok: false, reason: 'safety_flagged', issue: safetyIssue });
    }

    const html = generateProgramHTML(client, week_no, workout, nutrition, coach_notes);
    const htmlBuffer = Buffer.from(html, 'utf-8');
    const filePath = `clients/${client_id}/week_${week_no}.html`;

    await db.storage.from('programs').upload(filePath, htmlBuffer, {
      contentType: 'text/html',
      upsert: true
    });

    const { data: publicUrl } = db.storage.from('programs').getPublicUrl(filePath);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: publicUrl.publicUrl,
      workout_plan: workout,
      nutrition_plan: nutrition,
      notes: coach_notes || null
    });

    if (insertErr) throw insertErr;

    const contextNote = week_no === 1
      ? `Here's your Week 1 program! Let's build momentum.`
      : `Week ${week_no} is ready! ${workout.focus || 'Keep pushing.'}`;

    await sendClientMessage(client.phone, 'weekly_program', [
      client.name || 'there',
      `${week_no}`,
      contextNote,
      publicUrl.publicUrl
    ]);

    await db.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('client_id', client_id).eq('week_no', parseInt(week_no));

    await db.from('messages').insert({
      phone: client.phone,
      direction: 'out',
      body: `Week ${week_no} program sent`,
      template_name: 'weekly_program',
      status: 'sent'
    });

    return res.status(200).json({ ok: true, week_no, pdf_url: publicUrl.publicUrl });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
