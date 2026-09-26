# ClinicCare AI — Doctor AI Agent

A deployable clinic AI assistant that:
- chats with patients 24/7
- asks relevant follow-up questions
- provides general health information
- performs cautious urgency/triage guidance
- highlights emergency warning signs
- recommends an appropriate next step

## Safety
This is not a replacement for a licensed clinician. It does not intentionally diagnose, prescribe prescription medicines, or tell patients to stop prescribed treatment.

## Run locally
1. Install Node.js 18+
2. `npm install`
3. Set `OPENAI_API_KEY`
4. Optional: set `OPENAI_MODEL`
5. `npm start`
6. Open `http://localhost:3000`

## Render
Create a new Web Service from this GitHub repository.
Build command: `npm install`
Start command: `npm start`

Add environment variable:
`OPENAI_API_KEY` = your API key

Never put the API key in GitHub or in frontend JavaScript.
