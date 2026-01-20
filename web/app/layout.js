import "./globals.css";

export const metadata = {
  title: "Language",
  description: "Language learning chatbot",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="min-h-screen">{children}</div>
      </body>
    </html>
  );
}
