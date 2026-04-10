"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function FloatingClassifyContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Don't fetch on the classify page itself
    if (pathname === "/classify") return;

    const qs = searchParams.toString();
    fetch(`/api/stats${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        const unclassified =
          (data?.invoices?.unclassified || 0) +
          (data?.transactions?.unclassified || 0);
        setCount(unclassified);
      })
      .catch(() => {});
  }, [pathname, searchParams]);

  // Hide on classify page or when there's nothing to classify
  if (pathname === "/classify" || count === 0) return null;

  const qp = searchParams.toString() ? `?${searchParams.toString()}` : "";

  return (
    <Link
      href={`/classify${qp}`}
      className="fixed bottom-6 right-6 z-40 group flex items-center gap-3 px-5 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
      aria-label={`${count} items klaar om te classificeren`}
    >
      <div className="relative">
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
        <span className="absolute -top-2 -right-2 bg-white text-amber-600 rounded-full min-w-5 h-5 flex items-center justify-center text-xs font-bold px-1">
          {count > 99 ? "99+" : count}
        </span>
      </div>
      <span className="text-sm font-semibold whitespace-nowrap">
        Snel classificeren
      </span>
    </Link>
  );
}

export function FloatingClassify() {
  return (
    <Suspense fallback={null}>
      <FloatingClassifyContent />
    </Suspense>
  );
}
