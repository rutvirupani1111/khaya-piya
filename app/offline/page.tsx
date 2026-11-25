import type { Metadata } from "next";

export const metadata: Metadata = { title: "KhayaPiya: network gaya", robots: { index: false } };

/** What the service worker shows for a page it has never cached, when there is no network. */
export default function Offline() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pt-6">
      <section className="chalk rounded-xl px-5 pb-6 pt-4 shadow-[inset_0_0_0_6px_#5b3b22]">
        <h1 className="display text-4xl text-[#F4B400]">Network gaya</h1>
        <p className="hand mt-2 text-xl leading-snug">Jo bill is phone pe hai, wo safe hai. Counter, Table aur Shelf bina network ke chalte hain.</p>
        <p className="hand mt-2 text-xl leading-snug">Room ke kaam (claim, bhej diya, mila) phone pe line mein rukte hain aur network aate hi chale jaate hain.</p>
        <a href="/" className="tap press mt-5 inline-grid place-items-center rounded-md bg-[#F4B400] px-5 text-lg font-semibold text-[#1B1A17]">Counter pe chalo</a>
      </section>
    </main>
  );
}
