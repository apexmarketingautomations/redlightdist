export function GET() {
  return Response.json(
    { service: "redlightdist", status: "foundation", message: "Creator platform is under development. Registration and payments are not yet available." },
    { headers: { "Cache-Control": "no-store" } },
  );
}
