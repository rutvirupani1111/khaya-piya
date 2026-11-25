import { ImageResponse } from "next/og";
import { loadRoom } from "@/lib/server/room";

// The link preview a friend sees in WhatsApp: a thermal receipt on the chalkboard.
// It never shows per-person amounts or the UPI ID, only the restaurant, who paid and how many items.
export const runtime = "nodejs";
export const alt = "KhayaPiya: bill ka hisaab, tera hissa dekh";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const clean = (s: string, n: number) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, n);

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const room = /^[0-9A-HJKMNP-TV-Z]{7}$/.test(code) ? await loadRoom(null, code).catch(() => null) : null;
  const s = room && room.snapshot.status !== "closed" ? room.snapshot : null;
  const live = s !== null;
  const restaurant = s ? clean(s.restaurant || "Bill", 30).toUpperCase() : "KHAYAPIYA";
  const host = s ? clean(s.members.find((m) => m.id === s.hostMemberId)?.name || "Host", 18) : "";
  const count = s ? s.items.length : 0;
  const line = live ? `${host} ne bill bhara. Tera hissa dekh.` : "Bill ka hisaab, ek paisa idhar udhar nahi.";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#21352b", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 120, background: "linear-gradient(180deg, #8a5a34, #5b3b22)", display: "flex" }} />
        <div style={{ position: "absolute", left: 60, top: 54, display: "flex", color: "#F4B400", fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>KhayaPiya</div>
        <div style={{ position: "absolute", left: 62, top: 128, display: "flex", color: "#f1ecdf", fontSize: 28, opacity: 0.85 }}>bill baanto, UPI se bhejo, khata saaf</div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 560,
            marginLeft: 380,
            marginTop: 40,
            padding: "40px 44px 52px",
            background: "#f6eed9",
            color: "#1b1a17",
            transform: "rotate(-3deg)",
            boxShadow: "0 30px 60px rgba(0,0,0,.45)",
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "center", fontSize: 30, letterSpacing: 3, fontWeight: 700 }}>{restaurant}</div>
          <div style={{ display: "flex", marginTop: 18, borderTop: "3px dashed rgba(27,26,23,.35)" }} />
          <div style={{ display: "flex", marginTop: 26, fontSize: 44, lineHeight: 1.15, fontWeight: 700 }}>{line}</div>
          <div style={{ display: "flex", marginTop: 26, borderTop: "3px dashed rgba(27,26,23,.35)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, fontSize: 26, opacity: 0.8 }}>
            <span>{live ? `${count} ${count === 1 ? "cheez" : "cheezein"}` : "khaya-piya.vercel.app"}</span>
            <span>{live ? `ROOM ${code.slice(0, 3)} ${code.slice(3)}` : ""}</span>
          </div>
          <div style={{ position: "absolute", right: 34, bottom: 22, display: "flex", padding: "4px 16px", border: "5px solid #a61e1e", color: "#a61e1e", fontSize: 34, fontWeight: 700, borderRadius: 10, transform: "rotate(-9deg)", opacity: 0.85 }}>
            UPI
          </div>
        </div>
      </div>
    ),
    size,
  );
}
