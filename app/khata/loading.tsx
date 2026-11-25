// Shaped like the shelf and the ledger, at their final sizes. No spinner.
export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pt-4" aria-busy="true" aria-label="Khata khul raha hai">
      <div className="ph-light h-11 w-24" />
      <div className="ph-light mt-3 h-12 w-40" />
      <div className="mt-6 flex gap-3 px-1">
        {[0, 1, 2].map((i) => <div key={i} className="ph-light h-[150px] w-28 rounded-lg" />)}
      </div>
      <div className="teak h-4 rounded shadow-md" />
      <div className="cloth mt-8 rounded-md p-2 pt-3">
        <div className="ledger rounded-sm pb-4 pt-2">
          {[60, 80, 70, 75, 65].map((w, i) => (
            <div key={i} className="ledger-row flex items-center gap-3 pl-2 pr-3"><span className="ph h-3 w-8" /><span className="ph ml-4 h-3" style={{ width: `${w}%` }} /></div>
          ))}
        </div>
      </div>
    </main>
  );
}
