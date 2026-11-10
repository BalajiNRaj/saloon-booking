// Meta asks for a privacy policy URL when you set up the WhatsApp app.
// Edit the bracketed parts before going live.
export const metadata = { title: 'Privacy policy' };

export default function Privacy() {
  return (
    <main style={{ maxWidth: 680, margin: '60px auto', padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 24 }}>Privacy policy</h1>
      <p>
        This WhatsApp booking service is run by [YOUR NAME / BUSINESS NAME] for the salons that use it. When you message a
        salon on WhatsApp, we store your phone number, your WhatsApp profile name, the messages you send and receive, and
        the appointments you book.
      </p>
      <p>
        We use this only to book, remind you about and manage your appointments, and so the salon can see its bookings. We
        do not sell your data or use it for advertising.
      </p>
      <p>
        To have your data deleted, message the salon or email [YOUR EMAIL]. We delete it within 30 days of your request.
      </p>
      <p>Last updated: [DATE]</p>
    </main>
  );
}
