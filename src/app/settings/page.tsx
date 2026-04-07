"use client";

import { useEffect, useState } from "react";

type SettingsData = Record<string, string>;

const FIELDS = [
  { key: "business_name", label: "Bedrijfsnaam", placeholder: "Jouw Bedrijf BV" },
  { key: "vat_number", label: "BTW-nummer", placeholder: "BE0123.456.789" },
  { key: "address_line1", label: "Adres", placeholder: "Straatnaam 123" },
  { key: "postal_code", label: "Postcode", placeholder: "1000" },
  { key: "city", label: "Stad", placeholder: "Brussel" },
  { key: "email", label: "E-mail", placeholder: "jij@bedrijf.be" },
  { key: "phone", label: "Telefoon", placeholder: "+32 123 45 67 89" },
];

const BANK_INSTRUCTIONS = [
  { name: "KBC", steps: "KBC Mobile / KBC Touch \u2192 Rekeningen \u2192 Historiek \u2192 Exporteer (CSV)" },
  { name: "Belfius", steps: "Belfius Direct Net \u2192 Rekeningen \u2192 Rekeninguittreksels \u2192 Download CSV" },
  { name: "ING", steps: "ING Home'Bank \u2192 Rekeningen \u2192 Verrichtingen \u2192 Download (CSV)" },
  { name: "BNP Paribas Fortis", steps: "Easy Banking Web \u2192 Rekeningen \u2192 Historiek \u2192 Exporteer CSV" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const updateField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Laden...</div>;
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Instellingen</h1>
        <p className="text-gray-500 mt-1">Bedrijfsgegevens en configuratie</p>
      </div>

      {/* Business details */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Bedrijfsgegevens</h2>
        <p className="text-sm text-gray-500 mb-4">
          Deze gegevens verschijnen op je exportbestanden en het voorblad voor je boekhouder.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {FIELDS.map((field) => (
            <div key={field.key} className={field.key === "address_line1" ? "md:col-span-2" : ""}>
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

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Opslaan..." : "Opslaan"}
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Opgeslagen!</span>
          )}
        </div>
      </div>

      {/* Bank instructions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Bankkoppelingen</h2>
        <p className="text-sm text-gray-500 mb-4">
          Exporteer je bankafschriften als CSV en importeer ze via de Transacties pagina.
        </p>
        <div className="space-y-3">
          {BANK_INSTRUCTIONS.map((bank) => (
            <div key={bank.name} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{bank.name}</p>
                <p className="text-sm text-gray-500">{bank.steps}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API config note */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">API Configuratie</h2>
        <p className="text-sm text-gray-500">
          De Anthropic API key voor factuurextractie wordt geconfigureerd via het <code className="bg-gray-200 px-1 rounded">.env.local</code> bestand.
          Voeg <code className="bg-gray-200 px-1 rounded">ANTHROPIC_API_KEY=sk-ant-...</code> toe aan dit bestand.
        </p>
      </div>
    </div>
  );
}
