"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type SettingsData = Record<string, string>;
type Connections = {
  gmail: { connected: boolean; lastScan: string | null; configured: boolean };
  bank: { connected: boolean; lastSync: string | null; configured: boolean };
};

const BUSINESS_FIELDS = [
  { key: "business_name", label: "Bedrijfsnaam", placeholder: "Jouw Bedrijf BV" },
  { key: "vat_number", label: "BTW-nummer", placeholder: "BE0123.456.789" },
  { key: "address_line1", label: "Adres", placeholder: "Straatnaam 123", wide: true },
  { key: "postal_code", label: "Postcode", placeholder: "1000" },
  { key: "city", label: "Stad", placeholder: "Brussel" },
  { key: "email", label: "E-mail", placeholder: "jij@bedrijf.be" },
  { key: "phone", label: "Telefoon", placeholder: "+32 123 45 67 89" },
];

const API_FIELDS = [
  { key: "google_client_id", label: "Google Client ID", placeholder: "xxx.apps.googleusercontent.com", help: "Google Cloud Console \u2192 APIs & Services \u2192 Credentials \u2192 OAuth 2.0 Client ID" },
  { key: "google_client_secret", label: "Google Client Secret", placeholder: "GOCSPX-...", secret: true },
  { key: "nordigen_secret_id", label: "GoCardless Secret ID", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", help: "gocardless.com/bank-account-data \u2192 gratis account \u2192 API Keys" },
  { key: "nordigen_secret_key", label: "GoCardless Secret Key", placeholder: "xxxxxxxx...", secret: true },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<SettingsData>({});
  const [connections, setConnections] = useState<Connections | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<"idle" | "searching" | "extracting" | "done">("idle");
  const [scanProgress, setScanProgress] = useState<{ extracted: number; total: number } | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [bankConnecting, setBankConnecting] = useState(false);
  const [banks, setBanks] = useState<Array<{ id: string; name: string; logo: string }>>([]);
  const [showBankPicker, setShowBankPicker] = useState(false);

  const successMsg = searchParams.get("success");
  const errorMsg = searchParams.get("error");

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/connections").then((r) => r.json()),
    ]).then(([s, c]) => {
      setSettings(s);
      setConnections(c);
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    // Refresh connections after saving API keys
    const c = await fetch("/api/connections").then((r) => r.json());
    setConnections(c);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const updateField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const connectGmail = () => {
    window.location.href = "/api/auth/gmail";
  };

  const extractPending = async (totalToExtract: number) => {
    let totalExtracted = 0;
    let totalFailed = 0;
    let remaining = 1;
    const grandTotal = totalToExtract;
    while (remaining > 0) {
      const res = await fetch("/api/invoices/extract", { method: "POST" });
      if (!res.ok) break;
      const data = await res.json();
      totalExtracted += data.extracted;
      totalFailed += data.failed;
      remaining = data.remaining;
      setScanProgress({ extracted: totalExtracted, total: grandTotal });
      setScanResult(`${totalExtracted} van ${grandTotal} facturen verwerkt${totalFailed ? ` (${totalFailed} mislukt)` : ""}${remaining > 0 ? "" : " — klaar!"}`);
    }
    return { extracted: totalExtracted, failed: totalFailed };
  };

  const scanInbox = async () => {
    setScanning(true);
    setScanResult(null);
    setScanPhase("searching");
    setScanProgress(null);
    try {
      // Phase 1: Quick scan — find emails and save attachments
      const res = await fetch("/api/gmail/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setScanResult(`Fout: ${data.error}`);
        setScanPhase("idle");
        return;
      }

      if (data.errors?.length) {
        setScanResult(`${data.found} emails gevonden, ${data.imported} bijlagen opgeslagen — ${data.errors[0]}`);
        if (data.imported === 0) { setScanPhase("done"); return; }
      }

      if (data.imported === 0) {
        setScanResult(`${data.found} emails doorzocht — geen nieuwe facturen gevonden`);
        setScanPhase("done");
        return;
      }

      // Phase 2: Extract data from saved attachments
      setScanPhase("extracting");
      setScanProgress({ extracted: 0, total: data.imported });
      setScanResult(`${data.found} emails gevonden, ${data.imported} nieuwe bijlagen. Gegevens extraheren...`);
      await extractPending(data.imported);
      setScanPhase("done");
    } catch (e) { setScanResult(`Fout: ${(e as Error).message}`); setScanPhase("idle"); }
    finally { setScanning(false); }
  };

  const loadBanks = async () => {
    setBankConnecting(true);
    try {
      const res = await fetch("/api/bank/connect");
      const data = await res.json();
      if (data.banks) { setBanks(data.banks); setShowBankPicker(true); }
      else throw new Error(data.error);
    } catch (e) { alert("Fout: " + (e as Error).message); }
    finally { setBankConnecting(false); }
  };

  const connectBank = async (institutionId: string) => {
    try {
      const res = await fetch("/api/bank/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionId }),
      });
      const data = await res.json();
      if (data.link) {
        window.location.href = data.link; // Redirect to bank auth
      } else {
        throw new Error(data.error);
      }
    } catch (e) { alert("Fout: " + (e as Error).message); }
  };

  const syncBank = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/bank/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`${data.imported} transacties ge\u00EFmporteerd, ${data.skipped} duplicaten overgeslagen`);
      } else { setSyncResult(`Fout: ${data.error}`); }
    } catch (e) { setSyncResult(`Fout: ${(e as Error).message}`); }
    finally { setSyncing(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Instellingen</h1>
        <p className="text-gray-500 mt-1">Verbind je accounts en configureer je bedrijfsgegevens</p>
      </div>

      {/* Status messages */}
      {successMsg === "gmail_connected" && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">Gmail succesvol verbonden!</div>}
      {successMsg === "bank_connected" && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">Bank succesvol verbonden!</div>}
      {errorMsg && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">Er ging iets mis ({errorMsg}). Probeer opnieuw.</div>}

      {/* Connections */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Koppelingen</h2>

        {/* Gmail */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${connections?.gmail.connected ? "bg-green-100" : "bg-gray-200"}`}>
              <svg className={`w-5 h-5 ${connections?.gmail.connected ? "text-green-600" : "text-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Gmail</p>
              <p className="text-sm text-gray-500">
                {connections?.gmail.connected ? `Verbonden \u2022 Laatste scan: ${connections.gmail.lastScan ? new Date(connections.gmail.lastScan).toLocaleString("nl-BE") : "nog niet"}` :
                 connections?.gmail.configured ? "API keys ingesteld, nog niet verbonden" :
                 "Stel eerst Google Client ID/Secret in hieronder"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {connections?.gmail.connected ? (
              <button onClick={scanInbox} disabled={scanning} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {scanning ? "Scannen..." : "Inbox scannen"}
              </button>
            ) : connections?.gmail.configured ? (
              <button onClick={connectGmail} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Verbinden</button>
            ) : null}
          </div>
        </div>
        {/* Scan progress */}
        {scanning && (
          <div className="mb-3 px-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{scanPhase === "searching" ? "Inbox doorzoeken..." : scanProgress ? `${scanProgress.extracted} / ${scanProgress.total} facturen verwerkt` : "Bezig..."}</span>
              {scanPhase === "extracting" && scanProgress && scanProgress.total > 0 && (
                <span>{Math.round((scanProgress.extracted / scanProgress.total) * 100)}%</span>
              )}
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              {scanPhase === "searching" ? (
                /* Indeterminate animation while searching */
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
              ) : scanProgress && scanProgress.total > 0 ? (
                /* Real percentage bar during extraction */
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((scanProgress.extracted / scanProgress.total) * 100)}%` }}
                />
              ) : (
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
              )}
            </div>
          </div>
        )}
        {scanResult && !scanning && (
          <p className={`mb-3 px-4 text-sm ${scanResult.startsWith("Fout") ? "text-red-600" : scanPhase === "done" ? "text-green-600" : "text-gray-600"}`}>{scanResult}</p>
        )}

        {/* Bank */}
        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${connections?.bank.connected ? "bg-green-100" : "bg-gray-200"}`}>
              <svg className={`w-5 h-5 ${connections?.bank.connected ? "text-green-600" : "text-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
            </div>
            <div>
              <p className="font-medium text-gray-900">Bankrekening</p>
              <p className="text-sm text-gray-500">
                {connections?.bank.connected ? `Verbonden \u2022 Laatste sync: ${connections.bank.lastSync ? new Date(connections.bank.lastSync).toLocaleString("nl-BE") : "nog niet"}` :
                 connections?.bank.configured ? "API keys ingesteld, nog niet verbonden" :
                 "Stel eerst GoCardless API keys in hieronder"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {connections?.bank.connected ? (
              <button onClick={syncBank} disabled={syncing} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {syncing ? "Synchroniseren..." : "Transacties ophalen"}
              </button>
            ) : connections?.bank.configured ? (
              <button onClick={loadBanks} disabled={bankConnecting} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {bankConnecting ? "Laden..." : "Bank verbinden"}
              </button>
            ) : null}
          </div>
        </div>
        {syncResult && <p className={`mt-3 px-4 text-sm ${syncResult.startsWith("Fout") ? "text-red-600" : "text-green-600"}`}>{syncResult}</p>}
      </div>

      {/* Bank picker modal */}
      {showBankPicker && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowBankPicker(false)}>
          <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Kies je bank</h3>
            <div className="space-y-2">
              {banks.map((bank) => (
                <button key={bank.id} onClick={() => connectBank(bank.id)}
                  className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-colors">
                  {bank.logo && <img src={bank.logo} alt="" className="w-8 h-8 object-contain" />}
                  <span className="font-medium text-sm">{bank.name}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setShowBankPicker(false)} className="mt-4 w-full py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Annuleren</button>
          </div>
        </div>
      )}

      {/* API Keys */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">API Configuratie</h2>
        <p className="text-sm text-gray-500 mb-4">
          Sla je API keys op om Gmail en je bankrekening te verbinden. Keys worden lokaal opgeslagen.
        </p>
        <div className="space-y-4">
          {API_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
              {field.help && <p className="text-xs text-gray-400 mb-1">{field.help}</p>}
              <input
                type={field.secret ? "password" : "text"}
                value={settings[field.key] || ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Business details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Bedrijfsgegevens</h2>
        <p className="text-sm text-gray-500 mb-4">Verschijnen op je exportbestanden en het voorblad voor je boekhouder.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {BUSINESS_FIELDS.map((field) => (
            <div key={field.key} className={field.wide ? "md:col-span-2" : ""}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
              <input
                type="text"
                value={settings[field.key] || ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? "Opslaan..." : "Alles opslaan"}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">Opgeslagen!</span>}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}><SettingsContent /></Suspense>;
}
