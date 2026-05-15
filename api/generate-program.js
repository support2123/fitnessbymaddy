const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { generateProgramPDF } = require('../lib/pdf');
const { escalateToMaddy } = require('../lib/escalation');

const RISKY_PATTERNS = [
  /below\s*1[01]00\s*cal/i,
  /under\s*1[01]00\s*cal/i,
  /clenbuterol/i, /dnp/i, /ephedra/i, /steroids?/i, /sarms?/i,
  /lose\s*\d{2,}\s*(kg|lbs?)\s*in\s*(1|2|one|two)\s*week/i,
  /extreme\s*fast/i, /water\s*fast/i, /zero\s*carb/i,
];

function flagRiskyContent(text) {
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(str)) return pattern.source;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data
    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const systemPrompt = `You are a certified fitness program architect for FitnessByMaddy.
You create weekly workout and nutrition plans that are:
- Evidence-based and safe
- Progressively overloaded week to week
- Tailored to the client's check-in data, goals, and constraints
- Never extreme (no sub-1200 calorie diets, no banned substances, no unrealistic timelines)

Output ONLY valid JSON with this structure:
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 - Upper Body",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "options": ["Option A description", "Option B description"] }
    ]
  },
  "notes": "One-liner context for the client about this week's focus."
}`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
${intake ? `- Age: ${intake.age}, Gender: ${intake.gender}
- Goal: ${intake.goal}
- Injuries: ${intake.injuries || 'None'}
- Medical: ${intake.medical_conditions || 'None'}
- Diet: ${intake.diet_preference || 'No preference'}
- Workout days/week: ${intake.workout_days || 5}
- Location: ${intake.workout_location || 'Gym'}
- Current weight: ${intake.current_weight || 'N/A'}kg
- Target weight: ${intake.target_weight || 'N/A'}kg` : ''}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No check-ins yet (Week 1)'}

Generate a progressive, safe, personalised program for Week ${week_no}.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content[0].text;
    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      throw new Error('Failed to parse Claude response as JSON');
    }

    // Safety check
    const riskyFlag = flagRiskyContent(parsed);
    if (riskyFlag) {
      await escalateToMaddy({
        phone: client.phone,
        clientId: client_id,
        reason: `Risky program content detected: ${riskyFlag}`,
        messageBody: `Week ${week_no} program flagged for review`,
      });
      return res.status(200).json({ ok: false, flagged: true, reason: riskyFlag });
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF({
      clientName: client.name || 'Client',
      weekNo: week_no,
      workoutPlan: parsed.workout_plan,
      nutritionPlan: parsed.nutrition_plan,
      notes: parsed.notes,
    });

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    const { data: urlData } = supabase.storage
      .from('client-files')
      .getPublicUrl(pdfPath);

    // Save to programs table
    const { data: program } = await supabase.from('programs').upsert({
      client_id,
      week_no,
      pdf_url: urlData.publicUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }, { onConflict: 'client_id,week_no' }).select().single();

    // Send via WhatsApp
    const contextNote = parsed.notes || `Here's your Week ${week_no} program!`;
    await sendWhatsApp({
      phone: client.phone,
      templateName: 'weekly_program',
      bodyValues: [client.name || 'there', String(week_no), contextNote],
      mediaUrl: urlData.publicUrl,
    });

    // Update sent timestamp
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', program.id);

    return res.status(200).json({ ok: true, programId: program.id, pdfUrl: urlData.publicUrl });

  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
