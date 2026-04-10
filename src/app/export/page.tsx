"use client";

import { useEffect, useState, Suspense } from "react";
import { useQuarter } from "@/lib/use-quarter";

type Stats = {
  year: number; quarter: string;
  invoices: { total: number; professional: number; unclassified: number; total_professional_amount: number; total_vat: number };
  transactions: { total: number; professional: number; unclassified: number; matched: number; total_professional_amount: number };
  readyForExport: boolean;
};

function ExportContent() {
  const { year, quarter, queryString } = useQuarter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stats?${queryString}`)
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, [queryString]);

  const download = async (key: string, url: string, method: "GET" | "POST" = "GET", filename?: string) => {
    setDownloading(key);
    try {
      const res = method === "POST"
        ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, quarter }) })
        : await fetch(url);

      if (!res.ok) throw new Error((await res.json()).error || "Export mislukt");

      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || getFilename(res);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert("Export mislukt: " + (e as Error).message);
    } finally {
      setDownloading(null);
    }
  };

  const getFilename = (res: Response) => {
    const cd = res.headers.get("Content-Disposition");
    const match = cd?.match(/filename="?([^"]+)"?/);
    return match?.[1] || "export";
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  if (!stats) return null;

  const totalUnclassified = (stats.invoices.unclassified || 0) + (stats.transactions.unclassified || 0);
  const hasData = (stats.invoices.total || 0) > 0 || (stats.transactions.total || 0) > 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Exporteren</h1>
        <p className="text-gray-500 mt-1">{quarter} {year} — klaar voor je boekhouder</p>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Professionele facturen</p>
          <p className="text-2xl font-bold text-gray-900">{stats.invoices.professional || 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Totaal bedrag</p>
          <p className="text-2xl font-bold text-gray-900">{"\u20AC"}{(stats.invoices.total_professional_amount || 0).toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Aftrekbare BTW</p>
          <p className="text-2xl font-bold text-green-600">{"\u20AC"}{(stats.invoices.total_vat || 0).toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Gekoppelde transacties</p>
          <p className="text-2xl font-bold text-gray-900">{stats.transactions.matched || 0}</p>
        </div>
      </div>

      {/* Warning */}
      {totalUnclassified > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          <div>
            <p className="font-medium text-amber-800">{totalUnclassified} ongeclassificeerde items</p>
            <p className="text-sm text-amber-600">Alleen professionele items worden geëxporteerd.</p>
          </div>
        </div>
      )}

      {/* Hero: Complete package */}
      <div className="bg-blue-600 rounded-2xl p-6 mb-6 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold mb-2">Compleet boekhoudpakket</h2>
            <p className="text-blue-100 text-sm mb-1">Alles wat je boekhouder nodig heeft in één ZIP:</p>
            <ul className="text-blue-100 text-sm space-y-0.5 mb-4">
              <li>Voorblad met bedrijfsgegevens en samenvatting</li>
              <li>Excel overzicht (facturen, transacties, BTW)</li>
              <li>Alle factuur-PDF{"'"}s per categorie</li>
              <li>Bankafschrift als PDF</li>
            </ul>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>
          </div>
        </div>
        <button
          onClick={() => download("package", "/api/export/package", "POST", `Kwartio_${year}_${quarter}_Boekhoudpakket.zip`)}
          disabled={!hasData || downloading === "package"}
          className="w-full py-3 bg-white text-blue-600 rounded-xl font-semibold hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {downloading === "package" ? "Exporteren..." : "Boekhoudpakket downloaden"}
        </button>
      </div>

      {/* Individual exports */}
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Individuele exports</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ExportCard
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />}
          iconColor="bg-green-100 text-green-600"
          title="Excel overzicht"
          description="Samenvatting, facturen, transacties, BTW"
          downloading={downloading === "excel"}
          disabled={!hasData}
          onClick={() => download("excel", `/api/export/excel?${queryString}`)}
        />
        <ExportCard
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />}
          iconColor="bg-blue-100 text-blue-600"
          title="Facturen (PDF's)"
          description="ZIP met alle facturen per categorie"
          downloading={downloading === "invoices-zip"}
          disabled={!hasData}
          onClick={() => download("invoices-zip", `/api/export/invoices-zip?${queryString}`)}
        />
        <ExportCard
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />}
          iconColor="bg-purple-100 text-purple-600"
          title="Bankafschrift"
          description="PDF overzicht van alle transacties"
          downloading={downloading === "bank-statement"}
          disabled={!hasData}
          onClick={() => download("bank-statement", `/api/export/bank-statement?${queryString}`)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExportCard
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />}
          iconColor="bg-gray-100 text-gray-600"
          title="CSV Facturen"
          description="Puntkomma-gescheiden factuurgegevens"
          downloading={downloading === "csv-invoices"}
          disabled={!hasData}
          onClick={() => download("csv-invoices", `/api/export/csv?${queryString}&type=invoices`)}
        />
        <ExportCard
          icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />}
          iconColor="bg-gray-100 text-gray-600"
          title="CSV Transacties"
          description="Puntkomma-gescheiden transactiegegevens"
          downloading={downloading === "csv-transactions"}
          disabled={!hasData}
          onClick={() => download("csv-transactions", `/api/export/csv?${queryString}&type=transactions`)}
        />
      </div>
    </div>
  );
}

function ExportCard({ icon, iconColor, title, description, downloading, disabled, onClick }: {
  icon: React.ReactNode; iconColor: string; title: string; description: string;
  downloading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
        </div>
        <div>
          <p className="font-medium text-gray-900 text-sm">{title}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled || downloading}
        className="mt-auto w-full py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
      >
        {downloading ? "Downloaden..." : "Download"}
      </button>
    </div>
  );
}

export default function ExportPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}><ExportContent /></Suspense>;
}
