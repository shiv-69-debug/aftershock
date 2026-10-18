import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AccessError,
  authenticate,
  checkOrigin,
  COOKIE_NAME,
  createSession,
  login,
  logout,
  register,
} from "@/lib/workspaces/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return Response.json({ user: await authenticate(request) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AccessError
            ? error.message
            : "Authentication service unavailable.",
      },
      { status: error instanceof AccessError ? error.status : 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z
      .object({
        action: z.enum(["register", "login", "logout"]),
        username: z.string().max(40).optional(),
        password: z.string().max(128).optional(),
      })
      .parse(await request.json());
    if (input.action === "logout") {
      await logout(request);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    const user =
      input.action === "register"
        ? await register(input.username || "", input.password || "")
        : await login(input.username || "", input.password || "");
    const token = await createSession(user);
    const response = NextResponse.json({ user });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 7 * 86400,
    });
    return response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AccessError
            ? error.message
            : error instanceof z.ZodError
              ? "Invalid account request."
              : "Authentication service unavailable.",
      },
      {
        status:
          error instanceof AccessError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 503,
      },
    );
  }
}
