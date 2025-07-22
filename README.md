🛎️ Out-of-Stock Notify (Admin Dashboard)

This project enables customers to express interest in out-of-stock products, and gives admins a dashboard to view those interest requests.

⸻

✅ Project Overview

This full-stack system consists of:
	•	Frontend: Vite + React + TypeScript
	•	Backend: FastAPI
	•	Database: Supabase (PostgreSQL)
	•	Hosting: Railway (both frontend and backend)

⸻

🔧 Key Functionality

Users
	•	Submit interest in out-of-stock products (email, product ID, product title)

Admins
	•	View the 100 most recent interest submissions in a secure dashboard at admin.kitchenartsandletters.com

⸻

⚙️ Environment Variables

Frontend (.env)

	VITE_API_BASE_URL=https://outofstock-notify-production.up.railway.app
VITE_ADMIN_TOKEN=devtesttoken123

Backend (Railway ENV)

VITE_ADMIN_TOKEN=devtesttoken123


⸻

🔁 API Endpoint Summary

POST /api/interest

Submits an interest request.
Request body:

{
  "email": "user@example.com",
  "product_id": 123,
  "product_title": "Example Title"
}

GET /api/interest?token=YOUR_ADMIN_TOKEN

Returns a list of recent interest submissions.
Protected by token: must match VITE_ADMIN_TOKEN.

⸻

⚠️ Key Debugging Fixes
	•	✅ VITE_API_BASE_URL must be fully qualified (e.g. https://...)
	•	✅ Removed extraneous = in fetch:
		`${VITE_API_BASE_URL}/api/interest?token${VITE_ADMIN_TOKEN}` // ✅ no '='
	•	✅ FastAPI now includes CORS middleware to allow frontend-to-backend requests.
	•	✅ All backend routes are mounted under /api prefix (/api/interest).
	•	✅ Backend responds with JSON { success: true, data: [...] }, which is handled in the React frontend.
	•	✅ Corrected backend domain mismatch (frontend was pointing to the wrong Railway subdomain—must match deployed backend service exactly).

⸻

🚀 Deployment Instructions

1. Frontend Deployment (Railway)

Initial Setup
	•	Connect Railway frontend project to your GitHub repo
	•	In Settings > Environment, add:

VITE_API_BASE_URL=https://outofstock-notify-production.up.railway.app
VITE_ADMIN_TOKEN=your_admin_token_here



Build & Publish
	•	Railway auto-builds from the root of the frontend folder
	•	Make sure vite.config.ts is properly configured for production builds
	•	On successful deploy, Railway assigns a production URL (e.g. https://admin.kitchenartsandletters.com)

⸻

2. Backend Deployment (Railway)

Initial Setup
	•	Connect backend folder as a separate service in Railway
	•	Entry point must be app.main:app (FastAPI)
	•	Add this to Settings > Environment:

VITE_ADMIN_TOKEN=your_admin_token_here



Enable CORS (in main.py)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or restrict to your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Deploy
	•	On git push, Railway will auto-build and restart the backend container
	•	The backend will be available at a subdomain like:
https://outofstock-notify-production.up.railway.app

⸻

3. Local Development

Backend (FastAPI)

cd backend
uvicorn app.main:app --reload

Frontend (Vite)

cd frontend
npm run dev

Make sure .env contains the correct local VITE_API_BASE_URL, e.g.:

VITE_API_BASE_URL=http://localhost:8000


⸻

🧩 Next Steps
	•	Add user-facing form for product interest
	•	Connect frontend form to POST /api/interest
	•	Implement filters, pagination, and search in AdminDashboard
	•	Add logging and alerting for admin errors