import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const publicPath = pathname === "/login" || pathname === "/register" || pathname.startsWith("/auth/");
  if (!user && !publicPath) return NextResponse.redirect(new URL("/login", request.url));
  if (user && (pathname === "/login" || pathname === "/register")) return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
