export default function PersistentLabels() {
  return (
    <div className="bg-slate-100 border-b border-slate-200 px-6 py-2">
      <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-amber-800 border border-amber-200 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          <span>Simulated LKR budget — not real money</span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2.5 py-1 text-sky-800 border border-sky-200 font-medium">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
          <span>Cardano testnet — test ADA has no monetary value</span>
        </div>
      </div>
    </div>
  );
}
