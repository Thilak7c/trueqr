import Link from "next/link";

const btn = "flex h-14 w-full items-center justify-center rounded-2xl font-semibold";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-4 p-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">TrueQR</p>
      <h1 className="text-[32px] font-bold leading-tight">Know who you&apos;re paying</h1>
      <p className="mb-6 text-muted">Check that a DuitNow QR really belongs to the stall in front of you.</p>
      <Link href="/wallet" className={`${btn} bg-pay text-white`}>
        Open DemoPay
      </Link>
      <Link href="/register" className={`${btn} border-2 border-ink/15 bg-card`}>
        Register a stall
      </Link>
    </main>
  );
}
