# Salon Booking Bot (WhatsApp, no AI)

Customers book a salon appointment on WhatsApp by tapping buttons and lists:

```
"hi" → [Book appointment | My bookings | Talk to salon]
Book → pick service → pick stylist (or Anyone) → pick day → Morning/Afternoon/Evening → pick time → Confirm
My bookings → tap a booking → Cancel
Talk to salon → saves a call-back request for staff
Reminders → 24 hours and 2 hours before the appointment
```

Only free slots are shown. The database itself blocks double bookings, so two people can never get the same stylist at the same time.

**Stack:** Next.js on Vercel · Supabase (Postgres) · WhatsApp Cloud API · cron-job.org for reminders

```
app/api/whatsapp/route.js        webhook: Meta sends every customer message here
app/api/cron/reminders/route.js  sends reminders (called every 15 min)
app/privacy/page.js              privacy policy page Meta asks for
lib/bot.js                       the conversation (menus, booking, cancel)
lib/slots.js                     works out free times
lib/db.js                        all database queries
lib/whatsapp.js                  sends buttons, lists, text, templates
supabase/schema.sql              tables (run once)
supabase/seed.sql                a demo salon with 3 stylists and 9 services
tests/                           offline tests of the whole flow (npm test)
```

---

## Setup (about 1–2 hours the first time)

### 1. Supabase (database), free
1. Create a project at supabase.com. Pick the Mumbai region.
2. Go to **SQL Editor**, paste in `supabase/schema.sql` and run it.
3. Open **Project Settings → API** and copy the **Project URL** and the **service_role** key. Keep the service_role key secret.

### 2. Meta / WhatsApp, free test number
1. Go to developers.facebook.com, then **My Apps → Create app**. Choose the **Business** type and add the **WhatsApp** product.
2. In **WhatsApp → API Setup**:
   - Copy the **Phone number ID** of the test number.
   - Copy the **temporary access token**. It expires after 24 hours. That's fine for the first test, and step 6 below replaces it.
   - Under "To", add your own phone number and verify it with the code Meta sends. You can add up to 5 testers.
3. Copy the **App secret** from **App settings → Basic**.

### 3. Add the demo salon
In `supabase/seed.sql`, replace `REPLACE_WITH_PHONE_NUMBER_ID` with your Phone number ID. Then run the file in the Supabase SQL Editor.

### 4. Deploy to Vercel
1. Push this folder to a GitHub repo, then go to vercel.com and choose **Add New → Project → Import**.
2. Add these **Environment Variables** (see `.env.example`):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WA_TOKEN`, `WA_VERIFY_TOKEN` (make up a long random text), `WA_APP_SECRET`, `WA_GRAPH_VERSION` (match the version in Meta's sample code, e.g. v23.0), `CRON_SECRET` (another random text).
3. Deploy. You'll get a link like `https://salon-bot-xyz.vercel.app`.

### 5. Connect the webhook
In Meta, go to **WhatsApp → Configuration → Webhook → Edit**:
- **Callback URL:** `https://<your-app>.vercel.app/api/whatsapp`
- **Verify token:** the same text you used for `WA_VERIFY_TOKEN`
- Click **Verify and save**, then **subscribe to the `messages` field**.

**Test it:** from your phone, send **hi** to the test number on WhatsApp. You should get the menu.

### 6. Permanent token (before you show it to anyone)
In Meta Business Settings, go to **Users → System users → Add** (Admin). Assign your app to it, then **Generate token** with the `whatsapp_business_messaging` and `whatsapp_business_management` permissions. Put this token in `WA_TOKEN` on Vercel and redeploy.

### 7. Reminders
1. **Create the template.** Go to Meta **WhatsApp Manager → Message templates → Create**:
   - Category **Utility**, name `booking_reminder`, language **English**
   - Body:
     `Hi {{1}}, this is a reminder of your {{2}} appointment on {{3}} at {{4}} at {{5}}. Send MENU to cancel or rebook.`
   - Sample values: Meena · Haircut · Tue, 10 Nov · 3:30 PM · Demo Salon
   - Approval usually takes minutes to a few hours.
2. **Schedule it.** Vercel's free plan only runs scheduled jobs once a day, so use **cron-job.org** (free):
   - Create a job for the URL `https://<your-app>.vercel.app/api/cron/reminders?key=<CRON_SECRET>`
   - Run it **every 15 minutes**

Reminders use a template because WhatsApp only allows free-form messages within 24 hours of the customer's last message. Each reminder costs about ₹0.12 (utility rate) plus GST.

---

## Adding a real salon
1. Connect the salon's WhatsApp number to your Meta app, either directly or through a provider that supports **coexistence**, so the owner keeps the WhatsApp Business app on their phone.
2. Insert a row in `salons` with that number's **Phone number ID**, opening hours and closed days. `closed_days` uses 0 for Sunday through 6 for Saturday.
3. Add their `staff` (with weekly `off_days`) and `services` (with duration and price). For now you can do this in Supabase's Table Editor. An admin page comes later.

One deployment can serve many salons. The bot finds the right salon from the number the customer messaged.

## Running locally
```
cp .env.example .env.local   # fill it in
npm install
npm test                      # 19 offline tests: full booking, races, cancel, reminders
npm run dev
```
To receive real WhatsApp messages on your laptop you'd need a tunnel (e.g. ngrok). It's usually simpler to test on Vercel.

## Limits to know
- WhatsApp lists hold at most **10 rows**, so only the first 10 services and the first 9 stylists (plus "Anyone") are shown. That's enough for most salons.
- **Vercel's free (Hobby) plan is for non-commercial use.** Move to Pro, or host on Render or Railway, once salons are paying.
- **Supabase's free tier pauses after about a week with no activity.** Upgrade before going live.

## Next steps
- [ ] Admin page: calendar, bookings list, chat history (from the mockup)
- [ ] Staff can add walk-in and phone bookings from the admin page
- [ ] Advance payment with a Razorpay link (booking stays "pending" until it's paid)
- [ ] Review request after the visit, and a rebooking message for no-shows
- [ ] Optional AI upgrade: understand free text like "haircut tomorrow evening"
