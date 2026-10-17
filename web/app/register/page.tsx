import Register from "./Register";

export const dynamic = "force-dynamic";

// Demo gate, not auth (CLAUDE.md §7): token handed to the client as a server-rendered prop.
export default function RegisterPage() {
  return <Register token={process.env.DEMO_TOKEN ?? ""} />;
}
