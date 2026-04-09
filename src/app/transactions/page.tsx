"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useQuarter } from "@/lib/use-quarter";

type Transaction = {
  id: string; date: string; description: string | null; amount: number;
  counterparty: string | null; reference: string | null; classification: string;
  matched_invoice_id: string | null; matched_vendor: string | null;
  matched_invoice_file: string | null; category: string | null;
};

type InvoiceOption = { id: string; vendor: string | null; amount: number | null; invoice_date: string | null };

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

function TransactionsContent() {
  const { queryString } = useQuarter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<string | null>(null);
  const [matchingTxId, setMatchingTxId] = useState<string | null>(null);
  const [unmatchedInvoices, setUnmatchedInvoices] = useState<InvoiceOption[]>([]);
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set());
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [uploadingTxId, setUploadingTxId] = useState<string | null>(null);
  const [dialogTab, setDialogTab] = useState<"existing" | "upload">("existing");
  const [dialogDragOver, setDialogDragOver] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadTransactions = useCallback(() => {
    fetch(`/api/transactions?${queryString}`)
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions))
      .finally(() => setLoading(false));
  }, [queryString]);

  const loadMissingInvoices = useCallback(() => {
    fetch(`/api/transactions/missing-invoices?${queryString}`)
      .then((r) => r.json())
      .then((data) => {
        const ids = new Set<string>((data.transactions || []).map((t: Transaction) => t.id));
        setMissingIds(ids);
      })
      .catch(() => {});
  }, [queryString]);

  useEffect(() => { loadTransactions(); loadMissingInvoices(); }, [loadTransactions, loadMissingInvoices]);

  const handleImport = async (files: FileList) => {
    setImporting(true); setImportResult(null);
    const results: string[] = [];
    let anySuccess = false;

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/transactions/import", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
          results.push(`${file.name}: ${data.message}`);
          anySuccess = true;
        } else {
          results.push(`${file.name}: Fout - ${data.error}`);
        }
      } catch (e) { results.push(`${file.name}: Fout - ${(e as Error).message}`); }
    }

    setImportResult(results.join('\n'));
    if (anySuccess) { loadTransactions(); loadMissingInvoices(); }
    setImporting(false);
  };

  const handleUploadAndMatch = async (txId: string, file: File) => {
    setUploadingTxId(txId);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("transaction_id", txId);
    try {
      const res = await fetch("/api/transactions/upload-and-match", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        loadTransactions();
        loadMissingInvoices();
        setMatchingTxId(null);
      } else {
        alert(`Fout: ${data.error}`);
      }
    } catch (e) { alert(`Fout: ${(e as Error).message}`); }
    finally { setUploadingTxId(null); }
  };

  const runMatching = async () => {
    setMatching(true); setMatchResult(null);
    try {
      const res = await fetch("/api/matching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      setMatchResult(`${data.matched} transacties gekoppeld aan facturen`);
      loadTransactions(); loadMissingInvoices();
    } catch (e) { setMatchResult(`Fout: ${(e as Error).message}`); }
    finally { setMatching(false); }
  };

  const updateTransaction = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/api/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    loadTransactions(); loadMissingInvoices();
  };

  const openMatchDialog = async (txId: string) => {
    const res = await fetch(`/api/invoices?${queryString}&unmatched=true`);
    const data = await res.json();
    setUnmatchedInvoices(data.invoices);
    setMatchingTxId(txId);
    setDialogTab("existing");
  };

  const displayedTransactions = showMissingOnly
    ? transactions.filter(tx => missingIds.has(tx.id))
    : transactions;

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Transacties</h1>
        <p className="text-gray-500 mt-1">Importeer bankafschriften en koppel ze aan facturen</p>
      </div>

      {/* Missing invoices alert */}
      {missingIds.size > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <div>
              <p className="font-medium text-amber-800">{missingIds.size} transactie{missingIds.size !== 1 ? "s" : ""} zonder factuur</p>
              <p className="text-sm text-amber-600">Professionele uitgaven waarvoor nog geen factuur is gekoppeld</p>
            </div>
          </div>
          <button onClick={() => setShowMissingOnly(!showMissingOnly)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showMissingOnly ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}>
            {showMissingOnly ? "Toon alles" : "Toon ontbrekende"}
          </button>
        </div>
      )}

      {/* Import section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Bankafschrift importeren</h2>
          <InfoBubble text="Upload een CSV- of PDF-bestand van je bank. Kwartio herkent automatisch het formaat — werkt met elke Belgische bank (KBC, Belfius, ING, BNP, ...) en ook buitenlandse banken. Je kan meerdere bestanden tegelijk selecteren." />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bestand kiezen</label>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg cursor-pointer hover:bg-green-700 transition-colors text-sm font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <input type="file" accept=".csv,.txt,.pdf" multiple className="hidden" onChange={(e) => e.target.files?.length && handleImport(e.target.files)} disabled={importing} />
              {importing ? "Analyseren..." : "CSV of PDF uploaden"}
            </label>
            <p className="text-xs text-gray-400 mt-1">CSV, TXT of PDF — meerdere bestanden tegelijk mogelijk</p>
          </div>
          <div>
            <button onClick={runMatching} disabled={matching || transactions.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium inline-flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              {matching ? "Matchen..." : "Auto-match met facturen"}
            </button>
            <InfoBubble text="Koppelt transacties automatisch aan facturen op basis van bedrag, datum en naam. Hoe meer facturen je hebt ge\u00FCpload, hoe beter de matching werkt." />
          </div>
        </div>
        {importResult && <div className="mt-3 text-sm space-y-1">{importResult.split('\n').map((line, i) => (
          <p key={i} className={line.includes("Fout") ? "text-red-600" : "text-green-600"}>{line}</p>
        ))}</div>}
        {matchResult && <p className={`mt-2 text-sm ${matchResult.startsWith("Fout") ? "text-red-600" : "text-blue-600"}`}>{matchResult}</p>}
      </div>

      {/* Match dialog with upload tab */}
      {matchingTxId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setMatchingTxId(null)}>
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Koppel aan factuur</h3>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-4">
              <button onClick={() => setDialogTab("existing")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${dialogTab === "existing" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                Bestaande factuur
              </button>
              <button onClick={() => setDialogTab("upload")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${dialogTab === "upload" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                Nieuwe factuur uploaden
              </button>
            </div>

            {dialogTab === "existing" ? (
              /* Existing invoices list */
              unmatchedInvoices.length === 0 ? (
                <p className="text-gray-500 text-sm">Geen ongebruikte facturen gevonden. Upload een nieuwe factuur via het tabblad hierboven.</p>
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
              )
            ) : (
              /* Upload new invoice */
              <div
                onDragOver={(e) => { e.preventDefault(); setDialogDragOver(true); }}
                onDragLeave={() => setDialogDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDialogDragOver(false); if (e.dataTransfer.files?.[0]) handleUploadAndMatch(matchingTxId, e.dataTransfer.files[0]); }}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${dialogDragOver ? "border-blue-500 bg-blue-50" : "border-gray-300"}`}
              >
                {uploadingTxId === matchingTxId ? (
                  <div className="text-blue-600">
                    <svg className="animate-spin h-8 w-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                    <p className="font-medium text-sm">Factuur uploaden en analyseren...</p>
                  </div>
                ) : (
                  <>
                    <svg className="mx-auto h-10 w-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <p className="text-sm text-gray-600 font-medium">Sleep een factuur hierheen</p>
                    <p className="text-xs text-gray-500 mt-1">PDF, JPG, PNG — of klik hieronder</p>
                    <div className="flex justify-center gap-2 mt-3">
                      <label className="px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors text-sm font-medium">
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handleUploadAndMatch(matchingTxId, e.target.files[0])} />
                        Bestand kiezen
                      </label>
                      <label className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors text-sm font-medium inline-flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleUploadAndMatch(matchingTxId, e.target.files[0])} />
                        Foto nemen
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}

            <button onClick={() => setMatchingTxId(null)} className="mt-4 w-full px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Annuleren</button>
          </div>
        </div>
      )}

      {/* Transaction list */}
      {loading ? <p className="text-gray-500">Laden...</p> : displayedTransactions.length === 0 ? (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          <p className="text-lg text-gray-500">{showMissingOnly ? "Geen ontbrekende facturen" : "Nog geen transacties"}</p>
          <p className="text-sm text-gray-400 mt-1">{showMissingOnly ? "Alle uitgaven hebben een factuur" : "Upload een CSV- of PDF-bankafschrift hierboven om te starten"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-500 flex items-center justify-between">
            <span>{displayedTransactions.length} transacties{showMissingOnly ? " zonder factuur" : ""}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Datum</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Tegenpartij</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Omschrijving</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Factuur</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Classificatie</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedTransactions.map((tx) => (
                  <tr key={tx.id} className={`hover:bg-gray-50 ${missingIds.has(tx.id) ? "bg-amber-50/50" : ""}`}>
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
                        <div className="inline-flex items-center gap-1">
                          {missingIds.has(tx.id) && (
                            <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" title="Factuur ontbreekt"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                          )}
                          <button onClick={() => openMatchDialog(tx.id)} className="text-blue-500 hover:text-blue-700 text-xs font-medium">Koppelen</button>
                          {/* Quick upload button */}
                          {uploadingTxId === tx.id ? (
                            <svg className="animate-spin w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          ) : (
                            <button
                              onClick={() => fileInputRefs.current[tx.id]?.click()}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                              title="Factuur uploaden en koppelen"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                            </button>
                          )}
                          <input
                            ref={(el) => { fileInputRefs.current[tx.id] = el; }}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={(e) => { if (e.target.files?.[0]) handleUploadAndMatch(tx.id, e.target.files[0]); e.target.value = ""; }}
                          />
                        </div>
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
