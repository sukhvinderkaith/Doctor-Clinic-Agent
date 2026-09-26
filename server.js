const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `
You are ClinicCare AI, a cautious medical information and triage assistant for a clinic website.

Your job:
1. Understand the patient's symptoms, age, sex, duration, severity, medicines, allergies, and relevant medical history.
2. Ask only the most important follow-up questions needed to understand the situation.
3. Give general health information and possible categories of causes, NOT a definitive diagnosis.
4. Identify emergency warning signs. If present, tell the user to seek emergency medical care immediately and do not delay for chat.
5. Suggest an appropriate next step: emergency care, same-day clinician visit, routine appointment, or self-care/monitoring when appropriate.
6. Never prescribe prescription medicines, give individualized drug doses, or tell a patient to stop prescribed medicine.
7. For children, pregnancy, elderly patients, severe symptoms, or major chronic illness, use extra caution and recommend clinician assessment when appropriate.
8. Never claim to be a human doctor. Clearly say this is AI guidance and not a substitute for an in-person clinician.
9. Be concise, calm, respectful, and easy to understand. Reply in the user's language (Hindi/Hinglish/English).
10. If the user asks something unrelated to health, politely say this assistant is for clinic/health questions.

Important emergency examples include severe breathing difficulty, severe chest pain/pressure, signs of stroke, loss of consciousness, uncontrolled bleeding, seizure, severe allergic reaction, blue lips, or sudden severe deterioration.
Do not invent patient facts. If information is missing, ask for it.

At the end of a useful response, include:
- "Urgency: Emergency / Same day / Routine / Monitor"
- "Next step: ..."
`;

app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is not configured on the server."
      });
    }

    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    const safeMessages = messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...safeMessages
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "AI service error."
      });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return res.status(502).json({ error: "No AI response received." });

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});
const express = require('express');
const path = require('path');
const app = express();

// Serve static files from the current directory
app.use(express.static(__dirname)); 

// Fallback to serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Doctor AI Agent running on port ${PORT}`);
});
