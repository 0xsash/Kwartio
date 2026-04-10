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
  const [gmailConnected, setGmailConnected] = useState(false);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<"idle" | "searching" | "extracting" | "done">("idle");
  const [scanProgress, setScanProgress] = useState<{ extracted: number; total: number } | null>(null);

  const refreshStats = () => {
    fetch(`/api/stats?${queryString}`).then((r) => r.json()).then(setStats);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/stats?${queryString}`).then((r) => r.json()),
      fetch("/api/connections").then((r) => r.json()),
      fetch(`/api/transactions/missing-invoices?${queryString}&count=true`).then((r) => r.json()),
    ]).then(([s, c, m]) => {
      setStats(s);
      setGmailConnected(c?.gmail?.connected === true);
      setMissingCount(m.count || 0);
    }).finally(() => setLoading(false));
  }, [queryString]);

  const scanInbox = async () => {
    setScanning(true);
    setScanResult(null);
    setScanPhase("searching");
    setScanProgress(null);
    try {
      setScanResult("Inbox doorzoeken...");
      const res = await fetch("/api/gmail/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScanResult(`Fout: ${data.error || "Onbekende fout"}`);
        setScanPhase("idle");
        return;
      }
      if (data.errors?.length && data.found === 0) {
        setScanResult(data.errors[0]);
        setScanPhase("done");
        return;
      }
      if (data.found === 0) {
        setScanResult("Geen nieuwe e-mails met bijlagen gevonden.");
        setScanPhase("done");
        return;
      }

      setScanPhase("extracting");
      const totalMessages = data.found as number;
      let totalProcessed = 0;
      let totalImported = 0;
      let remaining = totalMessages;

      setScanProgress({ extracted: 0, total: totalMessages });
      setScanResult(`${totalMessages} e-mails gevonden. Bijlagen ophalen...`);

      while (remaining > 0) {
        const batchRes = await fetch("/api/gmail/process-batch", { method: "POST" });
        if (!batchRes.ok) break;
        const batchData = await batchRes.json();
        totalProcessed += (batchData.processed as number) || 0;
        totalImported += (batchData.imported as number) || 0;
        remaining = (batchData.remaining as number) ?? 0;
        setScanProgress({ extracted: totalProcessed, total: totalMessages });
        setScanResult(`${totalProcessed} van ${totalMessages} e-mails verwerkt \u2014 ${totalImported} bijlagen opgeslagen`);
      }

      if (totalImported === 0) {
        setScanResult(`${totalMessages} e-mails doorzocht \u2014 geen nieuwe facturen gevonden`);
        setScanPhase("done");
        refreshStats();
        return;
      }

      setScanResult(`${totalImported} nieuwe bijlagen opgeslagen. Gegevens extraheren...`);
      let totalExtracted = 0;
      let totalFailed = 0;
      let extractRemaining = 1;
      setScanProgress({ extracted: 0, total: totalImported });
      while (extractRemaining > 0) {
        const exRes = await fetch("/api/invoices/extract", { method: "POST" });
        if (!exRes.ok) break;
        const exData = await exRes.json();
        totalExtracted += (exData.extracted as number) || 0;
        totalFailed += (exData.failed as number) || 0;
        extractRemaining = (exData.remaining as number) ?? 0;
        setScanProgress({ extracted: totalExtracted, total: totalImported });
        setScanResult(`${totalExtracted} van ${totalImported} facturen verwerkt${totalFailed ? ` (${totalFailed} mislukt)` : ""}${extractRemaining > 0 ? "" : " \u2014 klaar!"}`);
      }

      setScanPhase("done");
      refreshStats();
    } catch (e) {
      setScanResult(`Fout: ${(e as Error).message}`);
      setScanPhase("idle");
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  if (!stats) return <div className="text-red-500">Fout bij laden van statistieken</div>;

  const totalUnclassified = (stats.invoices.unclassified || 0) + (stats.transactions.unclassified || 0);
  const qp = `?year=${year}&quarter=${quarter}`;
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
              <p className="font-semibold text-sm text-gray-900">Bankafschriften uploaden</p>
              <p className="text-xs text-gray-600 mt-1">Download je bankafschrift als CSV of PDF vanuit je online banking en upload het hier. Werkt met elke Belgische bank en kaart.</p>
            </div>
            <div className="bg-white/80 rounded-lg p-4">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm mb-2">3</div>
              <p className="font-semibold text-sm text-gray-900">Exporteren</p>
              <p className="text-xs text-gray-600 mt-1">Classificeer als professioneel/persoonlijk, en download het complete pakket voor je boekhouder.</p>
            </div>
          </div>
        </div>
      )}

      {/* Not connected banner */}
      {!gmailConnected && !isEmpty && (
        <Link href="/settings" className="block mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:bg-amber-100 transition-colors">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div>
              <p className="font-medium text-amber-800">Verbind je Gmail</p>
              <p className="text-sm text-amber-600">Ga naar Instellingen om je Gmail te koppelen. Kwartio vindt dan automatisch facturen in je inbox.</p>
            </div>
          </div>
        </Link>
      )}

      {/* Big Inbox scannen hero — the "magic button" */}
      {gmailConnected && (
        <div className="mb-6 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl p-6 text-white shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 backdrop-blur-sm">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold mb-1">Automatisch facturen vinden</h2>
                <p className="text-sm text-blue-100">Kwartio doorzoekt je Gmail-inbox op facturen, receipts en abonnementen van SaaS-diensten, Belgische leveranciers en meer.</p>
              </div>
            </div>
            <button
              onClick={scanInbox}
              disabled={scanning}
              className="px-6 py-3 bg-white text-blue-700 rounded-lg font-semibold hover:bg-blue-50 transition-colors disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2 shadow-sm flex-shrink-0"
            >
              {scanning ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                  Scannen...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Inbox scannen
                </>
              )}
            </button>
          </div>

          {/* Progress */}
          {scanning && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-blue-100 mb-1">
                <span>{scanPhase === "searching" ? "Inbox doorzoeken..." : scanProgress ? `${scanProgress.extracted} / ${scanProgress.total} verwerkt` : "Bezig..."}</span>
                {scanPhase === "extracting" && scanProgress && scanProgress.total > 0 && (
                  <span>{Math.round((scanProgress.extracted / scanProgress.total) * 100)}%</span>
                )}
              </div>
              <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                {scanPhase === "searching" ? (
                  <div className="h-full bg-white rounded-full animate-pulse w-full" />
                ) : scanProgress && scanProgress.total > 0 ? (
                  <div
                    className="h-full bg-white rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((scanProgress.extracted / scanProgress.total) * 100)}%` }}
                  />
                ) : (
                  <div className="h-full bg-white rounded-full animate-pulse w-full" />
                )}
              </div>
            </div>
          )}
          {scanResult && !scanning && (
            <p className={`mt-3 text-sm ${scanResult.startsWith("Fout") ? "text-red-100" : "text-blue-50"}`}>
              {scanResult}
            </p>
          )}
        </div>
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
          <div><p className="font-semibold text-gray-900">Bankafschriften</p><p className="text-sm text-gray-500">Upload CSV of PDF van je bank</p></div>
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
          {/* Missing invoices alert */}
          {missingCount > 0 && (
            <Link href={`/transactions${qp}`} className="block mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:bg-amber-100 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                </div>
                <div>
                  <p className="font-medium text-amber-800">{missingCount} transactie{missingCount !== 1 ? "s" : ""} zonder factuur</p>
                  <p className="text-sm text-amber-600">Professionele uitgaven waarvoor nog een factuur ontbreekt. Klik om te bekijken en facturen toe te voegen.</p>
                </div>
              </div>
            </Link>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Facturen" value={stats.invoices.total || 0} sub={`${stats.invoices.professional || 0} professioneel`} />
            <StatCard label="Transacties" value={stats.transactions.total || 0} sub={`${stats.transactions.matched || 0} gekoppeld`} />
            <StatCard label="Professioneel totaal" value={`\u20AC${(stats.invoices.total_professional_amount || 0).toFixed(2)}`} sub={`\u20AC${(stats.invoices.total_vat || 0).toFixed(2)} BTW`} />
            <StatCard label="Te classificeren" value={totalUnclassified} sub={totalUnclassified === 0 ? "Alles klaar!" : "Items wachten"} alert={totalUnclassified > 0} />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Voortgang kwartaalpakket</h2>
              <InfoBubble text="Je kwartaalpakket is klaar zodra alle facturen verwerkt, transacties gekoppeld en items geclassificeerd zijn. Dan kun je het volledige pakket downloaden via Exporteren." />
            </div>
            <div className="space-y-4">
              <ProgressRow label="Facturen verwerkt" done={stats.invoices.extracted || 0} total={stats.invoices.total || 0} />
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
