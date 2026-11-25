// The ledger at its final size while the page is fetched: tiffin, binding, ruled lines. No spinner.
export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 pt-4" aria-busy="true" aria-label="Khata khul raha hai">
      <div className="flex justify-between"><div className="ph-light h-11 w-28" /><div className="ph-light h-11 w-28" /></div>
      <div className="mt-3 flex items-end gap-3">
        <div className="ph-light h-[110px] w-[76px] rounded-lg" />
        <div className="flex-1 pb-1"><div className="ph-light h-9 w-48" /><div className="ph-light mt-2 h-4 w-40" /></div>
      </div>
      <div className="cloth mt-4 rounded-md p-2 pt-3">
        <div className="ledger rounded-sm pb-4 pt-1">
          <div className="ledger-row pl-[60px]"><span className="ph inline-block h-5 w-32 align-middle" /></div>
          {[70, 55, 62, 48].map((w, i) => (
            <div key={i} className="ledger-row flex items-center gap-2 pr-3"><span className="ph ml-4 size-4 rounded-full" /><span className="ph ml-7 h-3" style={{ width: `${w}%` }} /><span className="ph ml-auto h-3 w-16" /></div>
          ))}
          <div className="ledger-row mt-4 pl-[60px]"><span className="ph inline-block h-5 w-16 align-middle" /></div>
          {[80, 66, 74].map((w, i) => (
            <div key={i} className="ledger-row flex items-center gap-3 pr-3"><span className="ph ml-2 h-3 w-8" /><span className="ph ml-4 h-3" style={{ width: `${w}%` }} /></div>
          ))}
        </div>
      </div>
    </main>
  );
}
