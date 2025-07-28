🛎️ Out-of-Stock Notify (Admin Dashboard)

This project enables customers to express interest in out-of-stock products, and gives admins a dashboard to view those interest requests.

⸻

🌗 Dark Mode Support

The admin dashboard now supports dark mode via Tailwind CSS and a custom toggle component.

✅ Installation Lessons Learned
- Tailwind CSS setup must match the correct syntax and module format for your environment (e.g., use `.cjs` extensions for `tailwind.config.cjs` and `postcss.config.cjs` when using CommonJS).
- Always wrap Tailwind install commands in quotes when using Zsh to avoid shell expansion errors, e.g.:
  ```sh
  npm install -D "tailwindcss@^3.4" "postcss@^8.4" "autoprefixer@^10.4"
  ```
- If `npx tailwindcss` fails with "could not determine executable to run", prefer cleaning the project and reinstalling:
  ```sh
  rm -rf node_modules package-lock.json dist .vite
  npm cache clean --force
  npm install
  ```

✅ How Dark Mode Toggle Renders
- The `DarkModeToggle.tsx` component uses Tailwind's `dark:` class utility.
- The component toggles the `dark` class on the `html` element to trigger dark mode styling.
- Theme-based utility classes are applied directly via Tailwind (e.g., `bg-white dark:bg-gray-900`).
- No additional CSS frameworks or external styles are used—just Tailwind.

This ensures a minimal, scalable dark mode implementation across the app.

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

main-product.liquid snippet - currently written to line 514

<div id="notify-form-wrapper" class="product-form__line-item-field" style="margin-top: 1rem;">
                                      <label id="notify-label" for="notify-email" class="product-form__line-item-text-label">
                                        Want to be added to our request list?
                                      </label>
                                      <input
                                        id="notify-email"
                                        class="product-form__line-item-text-input"
                                        type="email"
                                        name="notify-email"
                                        placeholder="Enter your email"
                                        required
                                        style="margin-bottom: 0.5rem; width: 100%;"
                                      />
                                      <button
                                        type="button"
                                        id="notify-submit"
                                        class="c-btn c-btn--primary"
                                        style="margin-top: 0.25rem;"
                                      >
                                        Notify Me
                                      </button>
                                      <p id="notify-status" style="margin-top: 0.5rem; font-size: 0.9em;" aria-live="polite"></p>
                                    
                                      <!-- Hidden span for barcode injection -->
                                      <span id="shopify-barcode" style="display:none;">
                                        {{ product.variants.first.barcode | default: 'NO_BARCODE' }}
                                      </span>
                                    </div>
                                    
                                    <script>
                                      document.addEventListener('DOMContentLoaded', function () {
                                        const submitBtn = document.getElementById('notify-submit');
                                        const emailInput = document.getElementById('notify-email');
                                        const statusEl = document.getElementById('notify-status');
                                        const labelEl = document.getElementById('notify-label');
                                        const barcode = document.getElementById('shopify-barcode')?.textContent?.trim() || 'NO_BARCODE';
                                    
                                        {% if customer %}
                                          if (emailInput) emailInput.value = "{{ customer.email }}";
                                        {% endif %}
                                    
                                        const handleSubmit = async () => {
                                          const email = emailInput.value.trim();
                                          if (!email || !email.includes('@')) {
                                            statusEl.textContent = 'Please enter a valid email.';
                                            statusEl.style.color = 'red';
                                            return;
                                          }
                                    
                                          submitBtn.disabled = true;
                                          const originalText = submitBtn.textContent;
                                          submitBtn.textContent = 'Sending...';
                                    
                                          const data = {
                                            product_id: {{ product.id }},
                                            product_title: "{{ product.title | escape }}",
                                            isbn: barcode,
                                            email: email
                                          };
                                    
                                          console.log("Notify form submission payload:", data);
                                    
                                          try {
                                            const res = await fetch("https://api.kitchenartsandletters.com/api/interest", {
                                              method: "POST",
                                              headers: {
                                                "Content-Type": "application/json"
                                              },
                                              body: JSON.stringify(data)
                                            });
                                    
                                            if (res.ok) {
                                              statusEl.textContent = 'Thank you! We’ll notify you when this title is available.';
                                              statusEl.style.color = 'green';
                                              emailInput.style.display = 'none';
                                              submitBtn.style.display = 'none';
                                              labelEl.style.display = 'none';
                                            } else {
                                              statusEl.textContent = 'There was an issue submitting your request.';
                                              statusEl.style.color = 'red';
                                            }
                                          } catch (err) {
                                            statusEl.textContent = 'Network error. Please try again later.';
                                            statusEl.style.color = 'red';
                                          }
                                    
                                          submitBtn.disabled = false;
                                          submitBtn.textContent = originalText;
                                        };
                                    
                                        submitBtn?.addEventListener('click', handleSubmit);
                                    
                                        emailInput?.addEventListener('keydown', function (e) {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSubmit();
                                          }
                                        });
                                      });
                                    </script>

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