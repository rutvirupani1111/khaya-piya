// The closed bill folder at its final size, while the room is fetched. No spinner.
export default function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Bill aa raha hai">
      <div className="leather stitch relative flex h-[min(78vh,560px)] w-[min(88vw,360px)] flex-col items-center justify-center rounded-md px-6 shadow-2xl">
        <div className="ph-light h-8 w-48" />
        <div className="ph-light mt-4 h-4 w-32" />
        <div className="ph-light mt-3 h-10 w-36" />
        <div className="ph-light mt-6 h-12 w-40 rounded-full" />
      </div>
    </main>
  );
}
