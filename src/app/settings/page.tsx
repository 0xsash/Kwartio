"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type SettingsData = Record<string, string>;
type Connections = {
  gmail: { connected: boolean; lastScan: string | null; configured: boolean };
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

function SettingsContent() {
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<SettingsData>({});
  const [connections, setConnections] = useState<Connections | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanPhase, setScanPhase] = useState<"idle" | "searching" | "extracting" | "done">("idle");
  const [scanProgress, setScanProgress] = useState<{ extracted: number; total: number } | null>(null);
  const [showGmailConfig, setShowGmailConfig] = useState(false);

  const successMsg = searchParams.get("success");
  const errorMsg = searchParams.get("error");

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/connections").then((r) => r.json()),
    ]).then(([s, c]) => {
      setSettings(s || {});
      setConnections(c);
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
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
        setScanResult(`${totalProcessed} van ${totalMessages} e-mails verwerkt — ${totalImported} bijlagen opgeslagen`);
      }

      if (totalImported === 0) {
        setScanResult(`${totalMessages} e-mails doorzocht — geen nieuwe facturen gevonden`);
        setScanPhase("done");
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
        setScanResult(`${totalExtracted} van ${totalImported} facturen verwerkt${totalFailed ? ` (${totalFailed} mislukt)` : ""}${extractRemaining > 0 ? "" : " — klaar!"}`);
      }

      setScanPhase("done");
    } catch (e) {
      setScanResult(`Fout: ${(e as Error).message}`);
      setScanPhase("idle");
    } finally {
      setScanning(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;

  const gmailConnected = connections?.gmail?.connected === true;
  const gmailConfigured = connections?.gmail?.configured === true;
  const gmailLastScan = connections?.gmail?.lastScan ?? null;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Instellingen</h1>
        <p className="text-gray-500 mt-1">Verbind je Gmail en configureer je bedrijfsgegevens</p>
      </div>

      {/* Status messages */}
      {successMsg === "gmail_connected" && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          Gmail succesvol verbonden! Je kunt nu je inbox scannen op facturen.
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Er ging iets mis ({errorMsg}). Controleer je instellingen en probeer opnieuw.
        </div>
      )}

      {/* Gmail integration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${gmailConnected ? "bg-green-100" : "bg-gray-100"}`}>
              <svg className={`w-5 h-5 ${gmailConnected ? "text-green-600" : "text-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">Gmail</h2>
                {gmailConnected && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Verbonden</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                Kwartio doorzoekt je inbox op facturen en ontvangstbewijzen van SaaS-abonnementen, leveranciers en diensten.
              </p>
            </div>
          </div>
          {gmailConnected && (
            <button
              onClick={scanInbox}
              disabled={scanning}
              className="ml-4 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex-shrink-0"
            >
              {scanning ? "Scannen..." : "Inbox scannen"}
            </button>
          )}
        </div>

        {/* Scan progress */}
        {scanning && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{scanPhase === "searching" ? "Inbox doorzoeken..." : scanProgress ? `${scanProgress.extracted} / ${scanProgress.total} verwerkt` : "Bezig..."}</span>
              {scanPhase === "extracting" && scanProgress && scanProgress.total > 0 && (
                <span>{Math.round((scanProgress.extracted / scanProgress.total) * 100)}%</span>
              )}
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              {scanPhase === "searching" ? (
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-full" />
              ) : scanProgress && scanProgress.total > 0 ? (
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
          <p className={`mb-3 text-sm ${scanResult.startsWith("Fout") ? "text-red-600" : scanPhase === "done" ? "text-green-600" : "text-gray-600"}`}>
            {scanResult}
          </p>
        )}

        {/* Configuration accordion */}
        {!gmailConnected && (
          <div className="mt-3">
            {gmailConfigured ? (
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-800 font-medium mb-1">API-sleutels opgeslagen</p>
                <p className="text-xs text-blue-700 mb-3">Klik hieronder om Kwartio toegang te geven tot je Gmail-inbox.</p>
                <button onClick={connectGmail} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  Verbinden met Google
                </button>
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setShowGmailConfig(!showGmailConfig)}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  <svg className={`w-4 h-4 transition-transform ${showGmailConfig ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Instellen (vereist Google OAuth-sleutels)
                </button>

                {showGmailConfig && (
                  <div className="mt-3 space-y-3 pl-6 border-l-2 border-gray-100">
                    <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800">
                      <p className="font-medium mb-1">Hoe kom je aan Google OAuth-sleutels?</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Ga naar <span className="font-mono">console.cloud.google.com</span></li>
                        <li>Maak een nieuw project aan of selecteer een bestaand</li>
                        <li>Ga naar APIs &amp; Services → Credentials</li>
                        <li>Klik op &quot;+ Create Credentials&quot; → OAuth 2.0 Client ID</li>
                        <li>Kies &quot;Web application&quot; en voeg de redirect-URI toe</li>
                        <li>Kopieer Client ID en Client Secret hieronder</li>
                      </ol>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Google Client ID</label>
                      <input
                        type="text"
                        value={settings["google_client_id"] || ""}
                        onChange={(e) => updateField("google_client_id", e.target.value)}
                        placeholder="xxx.apps.googleusercontent.com"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Google Client Secret</label>
                      <input
                        type="password"
                        value={settings["google_client_secret"] || ""}
                        onChange={(e) => updateField("google_client_secret", e.target.value)}
                        placeholder="GOCSPX-..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                      />
                    </div>
                    <p className="text-xs text-gray-400">
                      Sla eerst op met de knop onderaan, dan verschijnt de &quot;Verbinden&quot;-knop.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {gmailConnected && gmailLastScan && (
          <p className="text-xs text-gray-400 mt-2">
            Laatste scan: {new Date(gmailLastScan).toLocaleString("nl-BE")}
          </p>
        )}
        {gmailConnected && !gmailLastScan && (
          <p className="text-xs text-gray-400 mt-2">Nog niet gescand — klik op &quot;Inbox scannen&quot; om te starten.</p>
        )}
      </div>

      {/* Manual upload tip */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-gray-700">Bankafschriften &amp; extra facturen</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Upload je bankafschriften (CSV/PDF) op de <a href="/transactions" className="text-blue-600 hover:underline">Bankafschriften-pagina</a>.
              Facturen die niet via Gmail binnenkomen (papieren bonnen, screenshots, downloads van portals) kun je uploaden op de <a href="/invoices" className="text-blue-600 hover:underline">Facturen-pagina</a>.
            </p>
          </div>
        </div>
      </div>

      {/* Business details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Bedrijfsgegevens</h2>
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
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
