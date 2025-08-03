import type { Metadata } from "next";


import ContextProvider from '@/context';
import { headers } from 'next/headers'; // added
import './globals.css';

export const metadata: Metadata = {
  title: "WavePay Demo",
  description: "WavePay Demo",
  icons: {
    icon: '/favicon.svg',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersData = await headers();
  const cookies = headersData.get('cookie');

  return (
    <html lang="en">
      <body>
        <ContextProvider cookies={cookies}>{children}</ContextProvider>
      </body>
    </html>
  );
}
