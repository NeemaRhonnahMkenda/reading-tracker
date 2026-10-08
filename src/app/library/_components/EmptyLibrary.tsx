// src/app/library/_components/EmptyLibrary.tsx

import Button from "../../components/ui/Button";

export default function EmptyLibrary({
  filtered,
  onAdd,
  onClear,
  canAdd,
}: {
  filtered: boolean;
  onAdd: () => void;
  onClear: () => void;
  canAdd: boolean;
}) {
  return (
    <div className="rounded-[1.8rem] bg-white/70 border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] px-6 py-16 sm:py-20 text-center">
      <div className="w-20 h-20 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-6">
        <span className="font-classical text-3xl text-[#9a86b9]">A</span>
      </div>
      <h2 className="font-classical text-2xl sm:text-3xl font-semibold text-[#0f172a]">
        {filtered ? "No books match" : "Your shelves are waiting"}
      </h2>
      <p className="mt-3 text-slate-500 font-light max-w-md mx-auto">
        {filtered ? "Try a different search, or loosen a filter or two." : "Add your first book by ISBN or by scanning its barcode."}
      </p>
      <div className="mt-7">
        {filtered ? (
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        ) : (
          <Button onClick={onAdd} disabled={!canAdd}>
            Add your first book
          </Button>
        )}
      </div>
    </div>
  );
}
