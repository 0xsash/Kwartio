"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useQuarter } from "@/lib/use-quarter";

type Transaction = {
  id: string; date: string; description: string | null; amount: number;
  counterparty: string | null; reference: string | null; classification: string;
  matched_invoice_id: string | null; matched_vendor: string | null;
  matched_invoice_file: string | null; category: string | null;
};

type InvoiceOption = { id: string; vendor: string | null; amount: number | null; invoice_date: string | null };

const BANK_OPTIONS = [
  { value: "", label: "Auto-detectie" },
  { value: "kbc", label: "KBC" },
  { value: "belfius", label: "Belfius" },
  { value: "ing", label: "ING" },
  { value: "bnp", label: "BNP Paribas Fortis" },
  { value: "generic", label: "Andere (generiek CSV)" },
];

function TransactionsContent() {
  const { queryString } = useQuarter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [bank, setBank] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [matchingTxId, setMatchingTxId] = useState<string | null>(null);
  const [unmatchedInvoices, setUnmatchedInvoices] = useState<InvoiceOption[]>([]);

  const loadTransactions = useCallback(() => {
    fetch(`/api/transactions?${queryString}`)
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions))
      .finally(() => setLoading(false));
  }, [queryString]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const handleImport = async (file: File) => {
    setImporting(true); setImportResult(null);
    const formData = new FormData();
    formData.append("file", file);
    if (bank) formData.append("bank", bank);
    try {
      const res = await fetch("/api/transactions/import", { method: "POST", body: formData });
      const data = await res.json();
      setImportResult(res.ok ? data.message : `Fout: ${data.error}`);
      if (res.ok) loadTransactions();
    } catch (e) { setImportResult(`Fout: ${(e as Error).message}`); }
    finally { setImporting(false); }
  };

  const runMatching = async () => {
    setMatching(true); setMatchResult(null);
    try {
      const res = await fetch("/api/matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      setMatchResult(`${data.matched} transacties gekoppeld aan facturen`);
      loadTransactions();
    } catch (e) { setMatchResult(`Fout: ${(e as Error).message}`); }
    finally { setMatching(false); }
  };

  const updateTransaction = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/api/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    loadTransactions();
  };

  const openMatchDialog = async (txId: string) => {
    const res = await fetch(`/api/invoices?${queryString}&unmatched=true`);
    const data = await res.json();
    setUnmatchedInvoices(data.invoices);
    setMatchingTxId(txId);
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Transacties</h1>
        <p className="text-gray-500 mt-1">Importeer bankafschriften en koppel ze aan facturen</p>
      </div>

      {/* Import section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Bank CSV importeren</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank</label>
            <select value={bank} onChange={(e) => setBank(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
              {BANK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CSV bestand</label>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg cursor-pointer hover:bg-green-700 transition-colors text-sm">
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])} disabled={importing} />
              {importing ? "Importeren..." : "CSV uploaden"}
            </label>
          </div>
          <button onClick={runMatching} disabled={matching || transactions.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
            {matching ? "Matchen..." : "Auto-match met facturen"}
          </button>
        </div>
        {importResult && <p className={`mt-3 text-sm ${importResult.startsWith("Fout") ? "text-red-600" : "text-green-600"}`}>{importResult}</p>}
        {matchResult && <p className={`mt-2 text-sm ${matchResult.startsWith("Fout") ? "text-red-600" : "text-blue-600"}`}>{matchResult}</p>}
      </div>

      {/* Match dialog */}
      {matchingTxId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setMatchingTxId(null)}>
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-96 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Koppel aan factuur</h3>
            {unmatchedInvoices.length === 0 ? (
              <p className="text-gray-500">Geen ongebruikte facturen gevonden</p>
            ) : (
              <div className="space-y-2">
                {unmatchedInvoices.map((inv) => (
                  <button key={inv.id} className="w-full text-left p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors"
                    onClick={() => { updateTransaction(matchingTxId, { matched_invoice_id: inv.id }); setMatchingTxId(null); }}>
                    <div className="flex justify-between">
                      <span className="font-medium text-sm">{inv.vendor || "Onbekend"}</span>
                      <span className="text-sm text-gray-500">{inv.amount != null ? `\u20AC${inv.amount.toFixed(2)}` : ""}</span>
                    </div>
                    <p className="text-xs text-gray-500">{inv.invoice_date || ""}</p>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setMatchingTxId(null)} className="mt-4 w-full px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Annuleren</button>
          </div>
        </div>
      )}

      {/* Transaction list */}
      {loading ? <p className="text-gray-500">Laden...</p> : transactions.length === 0 ? (
        <div className="text-center py-12 text-gray-500"><p className="text-lg">Nog geen transacties</p><p className="text-sm mt-1">Importeer je bankafschrift hierboven</p></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-500">{transactions.length} transacties</div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Datum</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Tegenpartij</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Omschrijving</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Gekoppeld</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Classificatie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{tx.date}</td>
                    <td className="px-4 py-3 text-sm font-medium max-w-48 truncate">{tx.counterparty || "\u2014"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-64 truncate">{tx.description || "\u2014"}</td>
                    <td className={`px-4 py-3 text-sm text-right font-mono whitespace-nowrap ${tx.amount < 0 ? "text-red-600" : "text-green-600"}`}>
                      {tx.amount < 0 ? "" : "+"}\u20AC{Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {tx.matched_vendor ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-green-600 text-xs">{tx.matched_vendor}</span>
                          <button onClick={() => updateTransaction(tx.id, { matched_invoice_id: null })} className="text-gray-400 hover:text-red-500" title="Ontkoppelen">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </span>
                      ) : (
                        <button onClick={() => openMatchDialog(tx.id)} className="text-blue-500 hover:text-blue-700 text-xs font-medium">Koppelen</button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select value={tx.classification} onChange={(e) => updateTransaction(tx.id, { classification: e.target.value })}
                        className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 ${tx.classification === "professional" ? "bg-blue-100 text-blue-700" : tx.classification === "personal" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                        <option value="unknown">Onbekend</option>
                        <option value="professional">Professioneel</option>
                        <option value="personal">Persoonlijk</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}><TransactionsContent /></Suspense>;
}
