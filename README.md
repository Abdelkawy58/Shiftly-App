# Shiftly — WFH Attendance Tracker

Runs outside Claude, for free, with data shared across every device via Supabase, and
installable as an app on your laptop and phone (PWA).

## 1. Create the free database (Supabase)

1. Go to https://supabase.com → sign up (free) → **New project**.
2. Wait ~1 minute for it to finish setting up.
3. Open **SQL Editor** (left sidebar) → **New query** → paste the contents of
   `supabase-setup.sql` (in this folder) → **Run**.
4. Go to **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key

## 2. Connect the app to your database

1. In this folder, copy `.env.example` to a new file named `.env`.
2. Paste your Project URL and anon key into it.

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

## 3. Run it locally to test

```
npm install
npm run dev
```

Open the printed http://localhost:5173 link. Everything should work exactly like the
Claude version — same passwords, same features.

## 4. Put it online for free (so employees can use it from anywhere)

1. Push this folder to a new GitHub repository (free account at https://github.com if
   you don't have one).
2. Go to https://vercel.com → sign up with your GitHub account (free).
3. **Add New Project** → pick this repository → in **Environment Variables**, add the
   same two values from your `.env` file → **Deploy**.
4. Vercel gives you a free link like `shiftly-yourname.vercel.app`. That's your live app.

## 5. Install it like an app (PWA)

Once it's live on Vercel (or even running locally):
- **On a phone**: open the link in the browser → menu → "Add to Home Screen" / "Install app".
- **On a laptop (Chrome/Edge)**: open the link → click the install icon in the address bar.

It'll open in its own window with its own icon, no browser bar — feels like a real app,
at no cost.

## Notes

- The owner/viewer/employee passwords set inside the app (Settings) are the only access
  control. The Supabase table itself is open to anyone holding the anon key (which ships
  inside the app's code, like it does for every Supabase frontend app). That's a normal
  and accepted setup for a small internal tool — just don't put anything more sensitive
  than shift/attendance data in here.
- If you ever want a custom domain (e.g. attendance.yourbusiness.com) instead of the
  vercel.app link, you can add it for free in Vercel's project settings once you own the
  domain (domains themselves typically cost ~$10-15/year from a registrar).
