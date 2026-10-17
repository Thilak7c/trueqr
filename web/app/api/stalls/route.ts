import { authed, reader, unauthorized } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!authed(req)) return unauthorized();
  try {
    const stalls = await reader.listStalls();
    return Response.json(stalls.map(({ id, name, photoURI, latE6, lngE6, active }) => ({ id, name, photoURI, latE6, lngE6, active })));
  } catch (e) {
    console.error("listStalls failed", String(e));
    return Response.json({ error: "chain read failed, try again" }, { status: 502 });
  }
}
