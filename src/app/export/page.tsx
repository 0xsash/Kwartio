"use client";

import { useEffect, useState } from "react";

type Stats = {
  year: number;
  quarter: string;
  invoices: {
    total: number;
    professional: number;
    personal: number;
    unclassified: number;
    total_professional_amount: number;
    total_vat: number;
  };
  transactions: {
    total: number;
    professional: number;
    personal: number;
    unclassified: number;
    matched: number;
    total_professional_amount: number;
  };
  readyForExport: boolean;
};

export default function ExportPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const handleExport = async () => {
    if (!stats) return;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: stats.year, quarter: stats.quarter }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Kwartio_${stats.year}_${stats.quarter}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (e) {
      alert("Export mislukt: " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  }

  if (!stats) return null;

  const totalUnclassified = (stats.invoices.unclassified || 0) + (stats.transactions.unclassified || 0);
  const hasData = (stats.invoices.total || 0) > 0 || (stats.transactions.total || 0) > 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Kwartaalpakket exporteren</h1>
        <p className="text-gray-500 mt-1">{stats.quarter} {stats.year} — klaar voor je boekhouder</p>
      </div>

      {/* What's included */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Wat zit er in het pakket?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Excel overzicht</p>
              <p className="text-sm text-gray-500">Samenvatting, facturen, transacties, BTW overzicht</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Facturen map</p>
              <p className="text-sm text-gray-500">Alle PDF's georganiseerd per categorie</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">BTW samenvatting</p>
              <p className="text-sm text-gray-500">Per BTW-tarief (6%, 12%, 21%)</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Transactie overzicht</p>
              <p className="text-sm text-gray-500">Alle professionele transacties met koppelingen</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Overzicht {stats.quarter} {stats.year}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">Professionele facturen</p>
            <p className="text-2xl font-bold text-gray-900">{stats.invoices.professional || 0}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Totaal bedrag</p>
            <p className="text-2xl font-bold text-gray-900">{"\u20AC"}{(stats.invoices.total_professional_amount || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Aftrekbare BTW</p>
            <p className="text-2xl font-bold text-green-600">{"\u20AC"}{(stats.invoices.total_vat || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Gekoppelde transacties</p>
            <p className="text-2xl font-bold text-gray-900">{stats.transactions.matched || 0}</p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {totalUnclassified > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div>
              <p className="font-medium text-amber-800">Er zijn nog {totalUnclassified} ongeclassificeerde items</p>
              <p className="text-sm text-amber-600">Alleen professionele items worden meegenomen in het exportpakket.</p>
            </div>
          </div>
        </div>
      )}

      {/* Export button */}
      <div className="text-center">
        {exported ? (
          <div className="py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-xl font-semibold text-gray-900">Pakket gedownload!</p>
            <p className="text-gray-500 mt-1">Stuur het ZIP bestand naar je boekhouder.</p>
            <button
              onClick={() => setExported(false)}
              className="mt-4 text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              Opnieuw downloaden
            </button>
          </div>
        ) : (
          <button
            onClick={handleExport}
            disabled={exporting || !hasData}
            className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Exporteren...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Kwartaalpakket downloaden
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
