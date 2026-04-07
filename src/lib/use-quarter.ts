"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback } from "react";

export function useQuarter() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const year = searchParams.get("year")
    ? parseInt(searchParams.get("year")!)
    : new Date().getFullYear();
  const quarter =
    searchParams.get("quarter") ||
    `Q${Math.floor(new Date().getMonth() / 3) + 1}`;

  const setQuarter = useCallback(
    (q: string, y: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("year", y.toString());
      params.set("quarter", q);
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const queryString = `year=${year}&quarter=${quarter}`;

  return { year, quarter, setQuarter, queryString };
}
