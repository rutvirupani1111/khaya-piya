"use client";
// Small fetch helper for the signed-in screens: JSON in, JSON out, the server's Hinglish error on failure.
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network nahi mila. Thodi der mein phir try karo.", 0);
  }
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(j.error || "Kuch gadbad ho gayi.", r.status);
  return j;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
