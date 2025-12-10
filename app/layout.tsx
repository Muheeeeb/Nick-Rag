import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nick - AI Assistant',
  description: 'Chat with Nick, your intelligent AI assistant powered by RAG',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

