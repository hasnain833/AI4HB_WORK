import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: redirect to /login when there is no session cookie.
// The cookie signature is verified server-side in getSessionUser().
const PUBLIC = ["/login", "/form/"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.has("aw_session")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
