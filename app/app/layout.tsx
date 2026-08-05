import { MobileAppShell } from "@/components/MobileAppShell";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MobileAppShell>
      {children}
    </MobileAppShell>
  );
}
