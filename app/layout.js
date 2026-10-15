import { Urbanist } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

// Same faces as the acemq.com "ace26" kit: Urbanist for display, Mona Sans for body/UI.
const urbanist = Urbanist({ subsets: ['latin'], weight: ['600', '700', '800'], display: 'swap', variable: '--font-urbanist' });
const mona = localFont({
  src: [
    { path: './fonts/Mona-Sans-Light.woff',    weight: '400', style: 'normal' },
    { path: './fonts/Mona-Sans-Medium.woff',   weight: '500', style: 'normal' },
    { path: './fonts/Mona-Sans-SemiBold.woff', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-mona',
});

export const metadata = {
  title: 'AceMQ — Onboarding',
  description: 'Complete your AceMQ onboarding for RabbitMQ engagement, support, and licensing.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${urbanist.variable} ${mona.variable}`}>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
