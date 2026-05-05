const {
  supabaseFetch,
  supabaseStorageUpload,
  getClient,
  maskPhone,
  detectLanguage,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

/**
 * POST /api/generate-program
 * Generates personalized workout + nutrition plan using Claude
 * Body: { client_id, week_no }
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    // Fetch client profile
    const client = await getClient(client_id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins
    const checkins = await supabaseFetch(
      `/checkins?client_id=eq.${encodeURIComponent(client_id)}&order=week_no.desc&limit=2`
    );

    // Fetch lead data for additional context
    let leadData = null;
    if (client.lead_id) {
      const leads = await supabaseFetch(`/leads?id=eq.${encodeURIComponent(client.lead_id)}&limit=1`);
      leadData = leads && leads.length > 0 ? leads[0] : null;
    }

    // Determine client gender (for safety checks)
    const gender = client.gender || leadData?.gender || 'female';
    const lang = detectLanguage(client.phone);

    // Build Claude prompt
    const systemPrompt = `You are the "Program Architect" for FitnessByMaddy, a premium fitness coaching service. You design progressive overload programs that are safe, effective, and personalized.

Your role:
- Design week-by-week training programs with progressive overload
- Create nutrition plans that are sustainable and culturally appropriate
- For Indian clients, include Indian food options and Hinglish notes where helpful
- Always prioritize safety - never suggest extreme measures

Output format: Return a JSON object with exactly two keys:
- "workout_plan": object with days as keys, each containing exercises with sets, reps, rest, and notes
- "nutrition_plan": object with calories, protein, carbs, fats, meal_plan (array of meals), hydration, and supplements

Important safety rules:
- Never suggest calorie intake below 1200 for women or 1400 for men
- Never recommend banned/controlled substances
- Never promise specific weight loss timelines that exceed 1kg/week
- If injuries are noted, modify exercises accordingly
- Progressive overload should be 5-10% increments maximum`;

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Start Date: ${client.start_date}
- Gender: ${gender}
- Age: ${leadData?.age || client.age || 'Unknown'}
- Goal: ${leadData?.goal || client.goal || 'General fitness'}
- Injuries/Limitations: ${leadData?.injuries || client.injuries || 'None reported'}
- Diet Preference: ${leadData?.diet_pref || client.diet_pref || 'No preference'}
- Schedule: ${leadData?.schedule || client.schedule || 'Flexible'}

RECENT CHECK-INS:
${checkins && checkins.length > 0
  ? checkins.map(c => `Week ${c.week_no}: Weight=${c.weight}kg, Waist=${c.waist}cm, Compliance=${c.compliance_score}/10, Energy=${c.energy}/10, Issues: ${c.issues || 'None'}`).join('\n')
  : 'No previous check-ins (this is the first week)'}

WEEK NUMBER: ${week_no} of ${client.total_weeks || 12}

Please design the program considering progressive overload from previous weeks. Return ONLY valid JSON.`;

    // Call Claude API
    const claudeResponse = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('Claude API error:', errText);
      return res.status(502).json({ error: 'AI generation failed' });
    }

    const claudeData = await claudeResponse.json();
    const aiContent = claudeData.content[0]?.text || '';

    // Parse JSON from Claude's response
    let programData;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
      programData = JSON.parse(jsonMatch[1].trim());
    } catch (parseErr) {
      console.error('Failed to parse Claude response as JSON:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    // Safety checks
    const nutritionPlan = programData.nutrition_plan || {};
    const calories = nutritionPlan.calories || 0;
    const minCalories = gender === 'male' ? 1200 : 1000;

    // Check for unsafe content
    const programStr = JSON.stringify(programData).toLowerCase();
    const bannedSubstances = ['steroid', 'clenbuterol', 'dnp', 'ephedra', 'sarm', 'hgh injection'];
    const hasBannedSubstance = bannedSubstances.some(s => programStr.includes(s));
    const hasExtremeCut = calories > 0 && calories < minCalories;
    const hasUnrealisticTimeline = programStr.includes('5kg per week') || programStr.includes('10kg in a week');

    if (hasBannedSubstance || hasExtremeCut || hasUnrealisticTimeline) {
      console.error(`SAFETY FLAG for client=${client_id}: banned=${hasBannedSubstance}, extreme_cut=${hasExtremeCut}, unrealistic=${hasUnrealisticTimeline}`);

      // Notify Maddy
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      await fetch(`${baseUrl}/api/send-whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: process.env.MADDY_PHONE,
          message: `SAFETY FLAG: Program for client ${client_id} (week ${week_no}) flagged. Calories: ${calories}, Banned substance: ${hasBannedSubstance}. Please review manually.`,
        }),
      });

      return res.status(200).json({
        success: false,
        flagged: true,
        reason: 'Safety check failed - flagged for manual review',
      });
    }

    // Generate HTML-based PDF content
    const htmlContent = generateProgramHTML(client, week_no, programData, lang);

    // Upload PDF content to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.html`;
    await supabaseStorageUpload('programs', pdfPath, Buffer.from(htmlContent, 'utf-8'), 'text/html');

    const pdfUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/programs/${pdfPath}`;

    // Insert into programs table
    await supabaseFetch('/programs', {
      method: 'POST',
      body: {
        client_id,
        week_no: Number(week_no),
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        pdf_url: pdfUrl,
        generated_at: new Date().toISOString(),
      },
    });

    // Send via WhatsApp
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const contextNote = lang === 'hinglish'
      ? `Yeh raha aapka Week ${week_no} program! Progressive overload ke saath designed hai. Koi doubt ho toh message karo.`
      : `Here's your Week ${week_no} program! Designed with progressive overload. Message us if you have any questions.`;

    await fetch(`${baseUrl}/api/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: client.phone,
        message: `${contextNote}\n\nProgram: ${pdfUrl}`,
      }),
    });

    console.log(`Program generated: client=${client_id}, week=${week_no}`);

    return res.status(200).json({
      success: true,
      client_id,
      week_no,
      pdf_url: pdfUrl,
    });
  } catch (error) {
    console.error('generate-program error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Generate HTML content for the program (to be rendered as PDF)
 */
function generateProgramHTML(client, weekNo, programData, lang) {
  const { workout_plan, nutrition_plan } = programData;

  let workoutHtml = '';
  if (workout_plan) {
    for (const [day, exercises] of Object.entries(workout_plan)) {
      workoutHtml += `<h3>${day}</h3><table><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>`;
      if (Array.isArray(exercises)) {
        for (const ex of exercises) {
          workoutHtml += `<tr><td>${ex.exercise || ex.name || ''}</td><td>${ex.sets || ''}</td><td>${ex.reps || ''}</td><td>${ex.rest || ''}</td><td>${ex.notes || ''}</td></tr>`;
        }
      } else if (typeof exercises === 'object' && exercises.exercises) {
        for (const ex of exercises.exercises) {
          workoutHtml += `<tr><td>${ex.exercise || ex.name || ''}</td><td>${ex.sets || ''}</td><td>${ex.reps || ''}</td><td>${ex.rest || ''}</td><td>${ex.notes || ''}</td></tr>`;
        }
      }
      workoutHtml += '</tbody></table>';
    }
  }

  let nutritionHtml = '';
  if (nutrition_plan) {
    nutritionHtml = `
      <div class="macros">
        <p><strong>Daily Calories:</strong> ${nutrition_plan.calories || 'TBD'}</p>
        <p><strong>Protein:</strong> ${nutrition_plan.protein || 'TBD'}g</p>
        <p><strong>Carbs:</strong> ${nutrition_plan.carbs || 'TBD'}g</p>
        <p><strong>Fats:</strong> ${nutrition_plan.fats || 'TBD'}g</p>
        <p><strong>Hydration:</strong> ${nutrition_plan.hydration || '3-4L water daily'}</p>
      </div>`;

    if (nutrition_plan.meal_plan && Array.isArray(nutrition_plan.meal_plan)) {
      nutritionHtml += '<h3>Meal Plan</h3><ul>';
      for (const meal of nutrition_plan.meal_plan) {
        if (typeof meal === 'string') {
          nutritionHtml += `<li>${meal}</li>`;
        } else {
          nutritionHtml += `<li><strong>${meal.meal || meal.time || ''}:</strong> ${meal.food || meal.description || JSON.stringify(meal)}</li>`;
        }
      }
      nutritionHtml += '</ul>';
    }

    if (nutrition_plan.supplements) {
      nutritionHtml += `<p><strong>Supplements:</strong> ${Array.isArray(nutrition_plan.supplements) ? nutrition_plan.supplements.join(', ') : nutrition_plan.supplements}</p>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FitnessByMaddy - Week ${weekNo} Program</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; color: #333; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
    .header h1 { margin: 0; font-size: 24px; }
    .header p { margin: 5px 0 0; opacity: 0.9; }
    h2 { color: #667eea; border-bottom: 2px solid #667eea; padding-bottom: 8px; }
    h3 { color: #4a5568; margin-top: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 20px; }
    th, td { padding: 10px 12px; text-align: left; border: 1px solid #e2e8f0; }
    th { background: #f7fafc; font-weight: 600; }
    tr:nth-child(even) { background: #f9fafb; }
    .macros { background: #f0fff4; padding: 15px; border-radius: 8px; border-left: 4px solid #48bb78; }
    .macros p { margin: 5px 0; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #718096; font-size: 14px; }
    ul { line-height: 1.8; }
  </style>
</head>
<body>
  <div class="header">
    <h1>FitnessByMaddy</h1>
    <p>${client.name || 'Client'} - Week ${weekNo} of ${client.total_weeks || 12}</p>
    <p>${client.program || 'Custom Program'}</p>
  </div>

  <h2>Workout Plan</h2>
  ${workoutHtml || '<p>Rest week - active recovery recommended.</p>'}

  <h2>Nutrition Plan</h2>
  ${nutritionHtml || '<p>Follow previous week\'s nutrition guidelines.</p>'}

  <div class="footer">
    <p>Generated by FitnessByMaddy | Questions? Message us on WhatsApp</p>
    <p>${lang === 'hinglish' ? 'Koi doubt ho toh message karo!' : 'Feel free to reach out with any questions!'}</p>
  </div>
</body>
</html>`;
}
