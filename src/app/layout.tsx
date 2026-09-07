import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRIA — Prestação de contas",
  description: "Área privada para organizar projetos, evidências e informações financeiras.",
  icons: { icon: "/tria.png", apple: "/tria.png" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
