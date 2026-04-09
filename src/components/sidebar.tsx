"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/invoices", label: "Facturen", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { href: "/transactions", label: "Transacties", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { href: "/classify", label: "Classificeren", icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" },
  { href: "/export", label: "Exporteren", icon: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { href: "/settings", label: "Instellingen", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-30 p-2 bg-white rounded-lg border border-gray-200 shadow-sm"
        aria-label="Menu openen"
      >
        <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/30 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 flex flex-col z-50 transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-blue-600">Kwartio</h1>
            <p className="text-sm text-gray-500 mt-1">Boekhouding, automatisch</p>
          </div>
          {/* Mobile close button */}
          <button onClick={() => setMobileOpen(false)} className="md:hidden p-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <Suspense fallback={<nav className="flex-1 p-4" />}>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </Suspense>

        <div className="p-4 border-t border-gray-200">
          <Suspense fallback={<div className="text-sm text-gray-500">Laden...</div>}>
            <QuarterSelector />
          </Suspense>
        </div>
      </aside>
    </>
  );
}

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qParams = searchParams.get("year") ? `?year=${searchParams.get("year")}&quarter=${searchParams.get("quarter") || "Q1"}` : "";

  return (
    <nav className="flex-1 p-4 space-y-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={`${item.href}${qParams}`}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function QuarterSelector() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const currentYear = new Date().getFullYear();
  const selectedYear = searchParams.get("year") ? parseInt(searchParams.get("year")!) : currentYear;
  const selectedQuarter = searchParams.get("quarter") || `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const quarters: Array<{ q: string; y: number }> = [];
  for (let y = currentYear; y >= currentYear - 1; y--) {
    for (let q = 4; q >= 1; q--) {
      quarters.push({ q: `Q${q}`, y });
    }
  }

  return (
    <div className="text-sm">
      <p className="text-gray-500 mb-2">Kwartaal</p>
      <select
        value={`${selectedQuarter}-${selectedYear}`}
        onChange={(e) => {
          const [q, y] = e.target.value.split("-");
          const params = new URLSearchParams();
          params.set("year", y);
          params.set("quarter", q);
          window.location.href = `${pathname}?${params.toString()}`;
        }}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
      >
        {quarters.map(({ q, y }) => (
          <option key={`${q}-${y}`} value={`${q}-${y}`}>
            {q} {y}
          </option>
        ))}
      </select>
    </div>
  );
}
