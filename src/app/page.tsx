"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  year: number;
  quarter: string;
  invoices: {
    total: number;
    professional: number;
    personal: number;
    unclassified: number;
    extracted: number;
    failed: number;
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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  }

  if (!stats) {
    return <div className="text-red-500">Fout bij laden van statistieken</div>;
  }

  const totalUnclassified = (stats.invoices.unclassified || 0) + (stats.transactions.unclassified || 0);

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Dashboard — {stats.quarter} {stats.year}
        </h1>
        <p className="text-gray-500 mt-1">Overzicht van je boekhouding dit kwartaal</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          href="/invoices"
          className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Facturen uploaden</p>
            <p className="text-sm text-gray-500">PDF, afbeeldingen</p>
          </div>
        </Link>

        <Link
          href="/transactions"
          className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Bank CSV importeren</p>
            <p className="text-sm text-gray-500">KBC, Belfius, ING, BNP</p>
          </div>
        </Link>

        {totalUnclassified > 0 ? (
          <Link
            href="/classify"
            className="flex items-center gap-4 p-4 bg-amber-50 rounded-xl border border-amber-200 hover:border-amber-300 hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <span className="text-amber-700 font-bold text-sm">{totalUnclassified}</span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Te classificeren</p>
              <p className="text-sm text-amber-600">{totalUnclassified} items wachten</p>
            </div>
          </Link>
        ) : (
          <Link
            href="/export"
            className="flex items-center gap-4 p-4 bg-green-50 rounded-xl border border-green-200 hover:border-green-300 hover:shadow-sm transition-all"
          >
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Exporteren</p>
              <p className="text-sm text-green-600">Klaar voor je boekhouder!</p>
            </div>
          </Link>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Facturen" value={stats.invoices.total || 0} sub={`${stats.invoices.professional || 0} professioneel`} />
        <StatCard label="Transacties" value={stats.transactions.total || 0} sub={`${stats.transactions.matched || 0} gekoppeld`} />
        <StatCard
          label="Professioneel totaal"
          value={`\u20AC${((stats.invoices.total_professional_amount || 0)).toFixed(2)}`}
          sub={`\u20AC${((stats.invoices.total_vat || 0)).toFixed(2)} BTW`}
        />
        <StatCard
          label="Te classificeren"
          value={totalUnclassified}
          sub={totalUnclassified === 0 ? "Alles klaar!" : "Items wachten"}
          alert={totalUnclassified > 0}
        />
      </div>

      {/* Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Voortgang kwartaalpakket</h2>
        <div className="space-y-4">
          <ProgressRow
            label="Facturen ge\u00EBxtraheerd"
            done={stats.invoices.extracted || 0}
            total={stats.invoices.total || 0}
          />
          <ProgressRow
            label="Transacties gekoppeld"
            done={stats.transactions.matched || 0}
            total={stats.transactions.total || 0}
          />
          <ProgressRow
            label="Items geclassificeerd"
            done={(stats.invoices.total || 0) + (stats.transactions.total || 0) - totalUnclassified}
            total={(stats.invoices.total || 0) + (stats.transactions.total || 0)}
          />
        </div>

        {stats.readyForExport && (stats.invoices.total > 0 || stats.transactions.total > 0) && (
          <Link
            href="/export"
            className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Kwartaalpakket downloaden
          </Link>
        )}
      </div>
    </div>
  );
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
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-500">{done}/{total}</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
