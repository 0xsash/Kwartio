"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useQuarter } from "@/lib/use-quarter";

type Stats = {
  year: number;
  quarter: string;
  invoices: { total: number; professional: number; personal: number; unclassified: number; extracted: number; failed: number; total_professional_amount: number; total_vat: number };
  transactions: { total: number; professional: number; personal: number; unclassified: number; matched: number; total_professional_amount: number };
  readyForExport: boolean;
};

type Connections = {
  gmail: { connected: boolean; lastScan: string | null; configured: boolean };
  bank: { connected: boolean; lastSync: string | null; configured: boolean };
};

function InfoBubble({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-block ml-1">
      <button onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onClick={() => setShow(!show)} className="w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-xs inline-flex items-center justify-center hover:bg-blue-100 hover:text-blue-600 transition-colors" aria-label="Info">?</button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg leading-relaxed">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-gray-900 rotate-45" />
        </div>
      )}
    </span>
  );
}

function DashboardContent() {
  const { year, quarter, queryString } = useQuarter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/stats?${queryString}`).then((r) => r.json()),
      fetch("/api/connections").then((r) => r.json()),
    ]).then(([s, c]) => { setStats(s); setConnections(c); })
      .finally(() => setLoading(false));
  }, [queryString]);

  const scanInbox = async () => {
    setScanning(true); setActionResult(null);
    const res = await fetch("/api/gmail/scan", { method: "POST" });
    const data = await res.json();
    setActionResult(res.ok ? `${data.imported} facturen uit inbox ge\u00EFmporteerd` : `Fout: ${data.error}`);
    setScanning(false);
    fetch(`/api/stats?${queryString}`).then((r) => r.json()).then(setStats);
  };

  const syncBank = async () => {
    setSyncing(true); setActionResult(null);
    const res = await fetch("/api/bank/sync", { method: "POST" });
    const data = await res.json();
    setActionResult(res.ok ? `${data.imported} transacties opgehaald` : `Fout: ${data.error}`);
    setSyncing(false);
    fetch(`/api/stats?${queryString}`).then((r) => r.json()).then(setStats);
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  if (!stats) return <div className="text-red-500">Fout bij laden van statistieken</div>;

  const totalUnclassified = (stats.invoices.unclassified || 0) + (stats.transactions.unclassified || 0);
  const qp = `?year=${year}&quarter=${quarter}`;
  const gmailOk = connections?.gmail.connected;
  const bankOk = connections?.bank.connected;
  const isEmpty = stats.invoices.total === 0 && stats.transactions.total === 0;

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard — {quarter} {year}</h1>
        <p className="text-gray-500 mt-1">Overzicht van je boekhouding dit kwartaal</p>
      </div>

      {/* First-time user onboarding */}
      {isEmpty && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-bold text-blue-900 mb-2">Welkom bij Kwartio!</h2>
          <p className="text-sm text-blue-800 mb-4">Kwartio helpt je om al je facturen en banktransacties te verzamelen en klaar te maken voor je boekhouder. Zo werkt het:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white/80 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm mb-2">1</div>
              <p className="font-semibold text-sm text-gray-900">Facturen verzamelen</p>
              <p className="text-xs text-gray-600 mt-1">Upload facturen (PDF/foto) of verbind je Gmail zodat Kwartio ze automatisch vindt.</p>
            </div>
            <div className="bg-white/80 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-sm mb-2">2</div>
              <p className="font-semibold text-sm text-gray-900">Transacties importeren</p>
              <p className="text-xs text-gray-600 mt-1">Upload een bankafschrift (CSV of PDF) — werkt met elke Belgische bank.</p>
            </div>
            <div className="bg-white/80 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm mb-2">3</div>
              <p className="font-semibold text-sm text-gray-900">Exporteren</p>
              <p className="text-xs text-gray-600 mt-1">Classificeer als professioneel/persoonlijk, en download het complete pakket voor je boekhouder.</p>
            </div>
          </div>
        </div>
      )}

      {/* Sync actions */}
      {(gmailOk || bankOk) && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-blue-800">Alles ophalen:</span>
            {gmailOk && (
              <button onClick={scanInbox} disabled={scanning} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {scanning ? "Inbox scannen..." : "Inbox scannen"}
              </button>
            )}
            {bankOk && (
              <button onClick={syncBank} disabled={syncing} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors">
                {syncing ? "Bank ophalen..." : "Bank ophalen"}
              </button>
            )}
            {actionResult && <span className={`text-sm ${actionResult.startsWith("Fout") ? "text-red-600" : "text-green-700"}`}>{actionResult}</span>}
          </div>
        </div>
      )}

      {/* Not connected banner */}
      {!gmailOk && !bankOk && !isEmpty && (
        <Link href="/settings" className="block mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:bg-amber-100 transition-colors">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="font-medium text-amber-800">Verbind je Gmail en bankrekening</p>
              <p className="text-sm text-amber-600">Ga naar Instellingen om je accounts te koppelen. Daarna haalt Kwartio alles automatisch op.</p>
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href={`/invoices${qp}`} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div><p className="font-semibold text-gray-900">Facturen</p><p className="text-sm text-gray-500">Upload PDF&apos;s of foto&apos;s van facturen</p></div>
        </Link>
        <Link href={`/transactions${qp}`} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          </div>
          <div><p className="font-semibold text-gray-900">Transacties</p><p className="text-sm text-gray-500">Upload bankafschrift (CSV of PDF)</p></div>
        </Link>
        {totalUnclassified > 0 ? (
          <Link href={`/classify${qp}`} className="flex items-center gap-4 p-4 bg-amber-50 rounded-xl border border-amber-200 hover:border-amber-300 hover:shadow-sm transition-all">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><span className="text-amber-700 font-bold text-sm">{totalUnclassified}</span></div>
            <div><p className="font-semibold text-gray-900">Te classificeren</p><p className="text-sm text-amber-600">{totalUnclassified} items wachten</p></div>
          </Link>
        ) : (
          <Link href={`/export${qp}`} className="flex items-center gap-4 p-4 bg-green-50 rounded-xl border border-green-200 hover:border-green-300 hover:shadow-sm transition-all">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div><p className="font-semibold text-gray-900">Exporteren</p><p className="text-sm text-green-600">Klaar voor je boekhouder!</p></div>
          </Link>
        )}
      </div>

      {!isEmpty && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Facturen" value={stats.invoices.total || 0} sub={`${stats.invoices.professional || 0} professioneel`} />
            <StatCard label="Transacties" value={stats.transactions.total || 0} sub={`${stats.transactions.matched || 0} gekoppeld`} />
            <StatCard label="Professioneel totaal" value={`\u20AC${(stats.invoices.total_professional_amount || 0).toFixed(2)}`} sub={`\u20AC${(stats.invoices.total_vat || 0).toFixed(2)} BTW`} />
            <StatCard label="Te classificeren" value={totalUnclassified} sub={totalUnclassified === 0 ? "Alles klaar!" : "Items wachten"} alert={totalUnclassified > 0} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Voortgang kwartaalpakket</h2>
              <InfoBubble text="Je kwartaalpakket is klaar zodra alle facturen ge??xtraheerd, transacties gekoppeld en items geclassificeerd zijn. Dan kun je het volledige pakket downloaden via Exporteren." />
            </div>
            <div className="space-y-4">
              <ProgressRow label="Facturen ge\u00EBxtraheerd" done={stats.invoices.extracted || 0} total={stats.invoices.total || 0} />
              <ProgressRow label="Transacties gekoppeld" done={stats.transactions.matched || 0} total={stats.transactions.total || 0} />
              <ProgressRow label="Items geclassificeerd" done={(stats.invoices.total || 0) + (stats.transactions.total || 0) - totalUnclassified} total={(stats.invoices.total || 0) + (stats.transactions.total || 0)} />
            </div>
            {stats.readyForExport && (stats.invoices.total > 0 || stats.transactions.total > 0) && (
              <Link href={`/export${qp}`} className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Kwartaalpakket downloaden
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}><DashboardContent /></Suspense>;
}

function StatCard({ label, value, sub, alert }: { label: string; value: string | number; sub: string; alert?: boolean }) {
  return (
    <div className={`p-4 rounded-xl border ${alert ? "bg-amber-50 border-amber-200" : "bg-white border-gray-200"}`}>
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? "text-amber-600" : "text-gray-900"}`}>{value}</p>
      <p className="text-sm text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function ProgressRow({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">{label}</span><span className="text-gray-500">{done}/{total}</span></div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
