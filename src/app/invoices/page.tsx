"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useQuarter } from "@/lib/use-quarter";

type Invoice = {
  id: string;
  file_path: string;
  original_filename: string;
  vendor: string | null;
  amount: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  invoice_date: string | null;
  invoice_number: string | null;
  description: string | null;
  category: string | null;
  classification: string;
  extraction_status: string;
};

const CATEGORIES: Record<string, string> = {
  software: "Software & Licenties",
  hosting: "Hosting & Cloud",
  telecom: "Telecom & Internet",
  office_supplies: "Kantoorbenodigdheden",
  travel: "Reiskosten",
  insurance: "Verzekeringen",
  professional_services: "Professionele Diensten",
  marketing: "Marketing & Reclame",
  subscriptions: "Abonnementen",
  hardware: "Hardware & Apparatuur",
  utilities: "Nutsvoorzieningen",
  meals: "Maaltijden & Representatie",
  transport: "Transport",
  other: "Overige",
};

function InvoicesContent() {
  const { queryString } = useQuarter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Invoice>>({});

  const loadInvoices = useCallback(() => {
    fetch(`/api/invoices?${queryString}`)
      .then((r) => r.json())
      .then((data) => setInvoices(data.invoices))
      .finally(() => setLoading(false));
  }, [queryString]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));
    try {
      await fetch("/api/invoices/upload", { method: "POST", body: formData });
      loadInvoices();
    } catch (e) {
      alert("Upload mislukt: " + (e as Error).message);
    } finally { setUploading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  const updateInvoice = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/api/invoices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...updates }) });
    loadInvoices();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("Factuur verwijderen?")) return;
    await fetch("/api/invoices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadInvoices();
  };

  const reExtract = async (id: string) => {
    await fetch("/api/invoices/re-extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadInvoices();
  };

  const toggleExpand = (inv: Invoice) => {
    if (expandedId === inv.id) { setExpandedId(null); return; }
    setExpandedId(inv.id);
    setEditData({ vendor: inv.vendor, amount: inv.amount, vat_amount: inv.vat_amount, vat_rate: inv.vat_rate, invoice_date: inv.invoice_date, invoice_number: inv.invoice_number, description: inv.description, category: inv.category });
  };

  const saveEdit = async (id: string) => {
    await updateInvoice(id, editData);
    setExpandedId(null);
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Facturen</h1>
        <p className="text-gray-500 mt-1">Upload en beheer je facturen</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`mb-8 border-2 border-dashed rounded-xl p-8 text-center transition-colors ${dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"}`}
      >
        {uploading ? (
          <div className="text-blue-600">
            <svg className="animate-spin h-8 w-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
            <p className="font-medium">Facturen uploaden en analyseren...</p>
            <p className="text-sm mt-1">Claude Vision extraheert alle gegevens automatisch</p>
          </div>
        ) : (
          <>
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <p className="mt-2 text-gray-600 font-medium">Sleep facturen hierheen</p>
            <p className="text-sm text-gray-500 mt-1">PDF, JPG, PNG — of klik om te bladeren</p>
            <div className="flex justify-center gap-2 mt-4">
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
                Bestanden kiezen
              </label>
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors md:hidden">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
                Foto nemen
              </label>
            </div>
          </>
        )}
      </div>

      {/* Invoice list */}
      {loading ? <p className="text-gray-500">Laden...</p> : invoices.length === 0 ? (
        <div className="text-center py-12 text-gray-500"><p className="text-lg">Nog geen facturen</p><p className="text-sm mt-1">Upload je eerste factuur hierboven</p></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Datum</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Leverancier</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Bedrag</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">BTW</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Categorie</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Classificatie</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  isExpanded={expandedId === inv.id}
                  editData={editData}
                  onToggle={() => toggleExpand(inv)}
                  onUpdate={updateInvoice}
                  onDelete={() => deleteInvoice(inv.id)}
                  onReExtract={() => reExtract(inv.id)}
                  onEditChange={(k, v) => setEditData(prev => ({ ...prev, [k]: v }))}
                  onSaveEdit={() => saveEdit(inv.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ inv, isExpanded, editData, onToggle, onUpdate, onDelete, onReExtract, onEditChange, onSaveEdit }: {
  inv: Invoice; isExpanded: boolean; editData: Partial<Invoice>;
  onToggle: () => void; onUpdate: (id: string, u: Record<string, unknown>) => void;
  onDelete: () => void; onReExtract: () => void;
  onEditChange: (k: string, v: unknown) => void; onSaveEdit: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 text-sm">{inv.invoice_date || "\u2014"}</td>
        <td className="px-4 py-3 text-sm font-medium">{inv.vendor || inv.original_filename}</td>
        <td className="px-4 py-3 text-sm">{inv.amount != null ? `\u20AC${inv.amount.toFixed(2)}` : "\u2014"}</td>
        <td className="px-4 py-3 text-sm">{inv.vat_amount != null ? `\u20AC${inv.vat_amount.toFixed(2)} (${inv.vat_rate}%)` : "\u2014"}</td>
        <td className="px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
          <select value={inv.category || ""} onChange={(e) => onUpdate(inv.id, { category: e.target.value })} className="text-sm border border-gray-200 rounded px-2 py-1">
            <option value="">\u2014</option>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${inv.extraction_status === "done" ? "bg-green-100 text-green-700" : inv.extraction_status === "failed" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
            {inv.extraction_status === "done" ? "Ge\u00EBxtraheerd" : inv.extraction_status === "failed" ? "Mislukt" : "Wachtend"}
          </span>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <select value={inv.classification} onChange={(e) => onUpdate(inv.id, { classification: e.target.value })}
            className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 ${inv.classification === "professional" ? "bg-blue-100 text-blue-700" : inv.classification === "personal" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
            <option value="unknown">Onbekend</option>
            <option value="professional">Professioneel</option>
            <option value="personal">Persoonlijk</option>
          </select>
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors" title="Verwijderen">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={8} className="px-4 py-4 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* File preview */}
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white" style={{ minHeight: 200 }}>
                {inv.original_filename.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={`/api/files/${inv.file_path}`} className="w-full h-64" />
                ) : (
                  <img src={`/api/files/${inv.file_path}`} alt={inv.original_filename} className="w-full h-64 object-contain" />
                )}
              </div>
              {/* Edit form */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500">Leverancier</label>
                    <input value={editData.vendor || ""} onChange={(e) => onEditChange("vendor", e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Factuurnummer</label>
                    <input value={editData.invoice_number || ""} onChange={(e) => onEditChange("invoice_number", e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Bedrag (incl. BTW)</label>
                    <input type="number" step="0.01" value={editData.amount ?? ""} onChange={(e) => onEditChange("amount", parseFloat(e.target.value) || null)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">BTW bedrag</label>
                    <input type="number" step="0.01" value={editData.vat_amount ?? ""} onChange={(e) => onEditChange("vat_amount", parseFloat(e.target.value) || null)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">BTW %</label>
                    <input type="number" value={editData.vat_rate ?? ""} onChange={(e) => onEditChange("vat_rate", parseFloat(e.target.value) || null)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Datum</label>
                    <input type="date" value={editData.invoice_date || ""} onChange={(e) => onEditChange("invoice_date", e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Omschrijving</label>
                  <input value={editData.description || ""} onChange={(e) => onEditChange("description", e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={onSaveEdit} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Opslaan</button>
                  {inv.extraction_status === "failed" && (
                    <button onClick={onReExtract} className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm hover:bg-amber-600">Opnieuw extraheren</button>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function InvoicesPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}><InvoicesContent /></Suspense>;
}
