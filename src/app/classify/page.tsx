"use client";

import { useEffect, useState, useCallback } from "react";

type ClassifyItem = {
  id: string;
  type: "invoice" | "transaction";
  name: string | null;
  description: string | null;
  amount: number | null;
  date: string | null;
  category: string | null;
};

export default function ClassifyPage() {
  const [items, setItems] = useState<ClassifyItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [classified, setClassified] = useState<Array<{ id: string; type: string; classification: string; name: string | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);

  const loadItems = useCallback(() => {
    fetch("/api/classify")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items);
        setCurrentIndex(0);
        setClassified([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const current = items[currentIndex];
  const remaining = items.length - currentIndex;

  const classify = (classification: "professional" | "personal") => {
    if (!current) return;
    setSwipeDir(classification === "personal" ? "left" : "right");

    setTimeout(() => {
      setClassified((prev) => [
        ...prev,
        { id: current.id, type: current.type, classification, name: current.name },
      ]);
      setCurrentIndex((i) => i + 1);
      setSwipeDir(null);
    }, 200);
  };

  const saveAll = async () => {
    if (classified.length === 0) return;
    setSaving(true);
    try {
      await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classifications: classified }),
      });
      loadItems();
    } catch (e) {
      alert("Fout bij opslaan: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") classify("personal");
      if (e.key === "ArrowRight" || e.key === "d") classify("professional");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Classificeren</h1>
        <p className="text-gray-500 mt-1">Swipe of gebruik pijltjestoetsen</p>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-500 mb-2">
          <span>{classified.length} geclassificeerd</span>
          <span>{remaining} resterend</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${items.length > 0 ? (classified.length / items.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {!current ? (
        <div className="text-center py-16">
          {classified.length > 0 ? (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xl font-semibold text-gray-900 mb-2">
                {classified.length} items geclassificeerd
              </p>
              <button
                onClick={saveAll}
                disabled={saving}
                className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Opslaan..." : "Alles opslaan"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xl font-semibold text-gray-900">Alles is geclassificeerd!</p>
              <p className="text-gray-500 mt-2">Geen items meer om te classificeren dit kwartaal.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Card */}
          <div
            className={`bg-white rounded-2xl border border-gray-200 shadow-lg p-8 mb-8 transition-all duration-200 ${
              swipeDir === "left" ? "-translate-x-32 opacity-0 rotate-[-5deg]" :
              swipeDir === "right" ? "translate-x-32 opacity-0 rotate-[5deg]" : ""
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                current.type === "invoice" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
              }`}>
                {current.type === "invoice" ? "Factuur" : "Transactie"}
              </span>
              <span className="text-sm text-gray-500">{current.date || "Geen datum"}</span>
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-2">
              {current.name || "Onbekend"}
            </h3>

            {current.description && (
              <p className="text-gray-600 mb-4">{current.description}</p>
            )}

            <div className="text-3xl font-bold text-gray-900">
              {current.amount != null ? (
                <span className={current.amount < 0 ? "text-red-600" : "text-gray-900"}>
                  {current.amount < 0 ? "-" : ""}\u20AC{Math.abs(current.amount).toFixed(2)}
                </span>
              ) : "—"}
            </div>

            {current.category && (
              <p className="text-sm text-gray-500 mt-2">Categorie: {current.category}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-center gap-8">
            <button
              onClick={() => classify("personal")}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-sm font-medium text-purple-600">Persoonlijk</span>
              <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">\u2190 / A</kbd>
            </button>

            <button
              onClick={() => classify("professional")}
              className="flex flex-col items-center gap-2 group"
            >
              <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-medium text-blue-600">Professioneel</span>
              <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">\u2192 / D</kbd>
            </button>
          </div>

          {/* Save button (if items have been classified) */}
          {classified.length > 0 && (
            <div className="mt-8 text-center">
              <button
                onClick={saveAll}
                disabled={saving}
                className="px-6 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {saving ? "Opslaan..." : `${classified.length} classificaties opslaan`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
