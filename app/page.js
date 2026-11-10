// Placeholder home page. The admin page (calendar, bookings, chat history) comes in week 4.
export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: '80px auto', padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>Salon Booking Bot</h1>
      <p>The WhatsApp bot is running. Webhook: <code>/api/whatsapp</code></p>
      <p>
        <a href="/privacy">Privacy policy</a>
      </p>
    </main>
  );
}
