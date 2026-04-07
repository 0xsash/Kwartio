"use client";

import { useEffect, useState, useCallback } from "react";

type Invoice = {
  id: string;
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

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadInvoices = useCallback(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((data) => setInvoices(data.invoices))
      .finally(() => setLoading(false));
  }, []);

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
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const updateInvoice = async (id: string, updates: Record<string, unknown>) => {
    await fetch("/api/invoices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    loadInvoices();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("Factuur verwijderen?")) return;
    await fetch("/api/invoices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadInvoices();
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
        className={`mb-8 border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"
        }`}
      >
        {uploading ? (
          <div className="text-blue-600">
            <svg className="animate-spin h-8 w-8 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="font-medium">Facturen uploaden en analyseren...</p>
            <p className="text-sm mt-1">Claude Vision extraheert alle gegevens automatisch</p>
          </div>
        ) : (
          <>
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-2 text-gray-600 font-medium">Sleep facturen hierheen</p>
            <p className="text-sm text-gray-500 mt-1">PDF, JPG, PNG — of klik om te bladeren</p>
            <label className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => e.target.files && handleUpload(e.target.files)}
              />
              Bestanden kiezen
            </label>
          </>
        )}
      </div>

      {/* Invoice list */}
      {loading ? (
        <p className="text-gray-500">Laden...</p>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">Nog geen facturen</p>
          <p className="text-sm mt-1">Upload je eerste factuur hierboven</p>
        </div>
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
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{inv.invoice_date || "—"}</td>
                  <td className="px-4 py-3 text-sm font-medium">{inv.vendor || inv.original_filename}</td>
                  <td className="px-4 py-3 text-sm">{inv.amount != null ? `\u20AC${inv.amount.toFixed(2)}` : "—"}</td>
                  <td className="px-4 py-3 text-sm">{inv.vat_amount != null ? `\u20AC${inv.vat_amount.toFixed(2)} (${inv.vat_rate}%)` : "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    <select
                      value={inv.category || ""}
                      onChange={(e) => updateInvoice(inv.id, { category: e.target.value })}
                      className="text-sm border border-gray-200 rounded px-2 py-1"
                    >
                      <option value="">—</option>
                      {Object.entries(CATEGORIES).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.extraction_status} />
                  </td>
                  <td className="px-4 py-3">
                    <ClassificationBadge
                      classification={inv.classification}
                      onChange={(c) => updateInvoice(inv.id, { classification: c })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteInvoice(inv.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="Verwijderen"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    done: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    done: "Geëxtraheerd",
    pending: "Wachtend",
    processing: "Bezig...",
    failed: "Mislukt",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  );
}

function ClassificationBadge({ classification, onChange }: { classification: string; onChange: (c: string) => void }) {
  const styles: Record<string, string> = {
    professional: "bg-blue-100 text-blue-700",
    personal: "bg-purple-100 text-purple-700",
    unknown: "bg-gray-100 text-gray-500",
  };
  const labels: Record<string, string> = {
    professional: "Professioneel",
    personal: "Persoonlijk",
    unknown: "Onbekend",
  };

  return (
    <select
      value={classification}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 ${styles[classification] || styles.unknown}`}
    >
      <option value="unknown">{labels.unknown}</option>
      <option value="professional">{labels.professional}</option>
      <option value="personal">{labels.personal}</option>
    </select>
  );
}
