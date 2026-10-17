import Wallet from "./Wallet";

export const dynamic = "force-dynamic";

// The demo token is a demo gate, not auth (CLAUDE.md §7): it's handed to the client as a server-rendered prop.
export default function WalletPage() {
  return <Wallet token={process.env.DEMO_TOKEN ?? ""} />;
}
