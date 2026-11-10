export const metadata = { title: 'Salon Booking Bot' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#F6F7F5', color: '#16181D' }}>{children}</body>
    </html>
  );
}
