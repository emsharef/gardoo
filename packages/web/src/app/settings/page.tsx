"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Garden data
  const gardensQuery = trpc.gardens.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const garden = gardensQuery.data?.[0];

  // API Keys
  const apiKeysQuery = trpc.apiKeys.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // User settings
  const settingsQuery = trpc.users.getSettings.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // Garden form
  const [gardenName, setGardenName] = useState("");
  const [hardinessZone, setHardinessZone] = useState("");
  const [locationLat, setLocationLat] = useState("");
  const [locationLng, setLocationLng] = useState("");

  useEffect(() => {
    if (garden) {
      setGardenName(garden.name);
      setHardinessZone(garden.hardinessZone ?? "");
      setLocationLat(garden.locationLat?.toString() ?? "");
      setLocationLng(garden.locationLng?.toString() ?? "");
    }
  }, [garden]);

  // HA form
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");

  useEffect(() => {
    if (settingsQuery.data) {
      setHaUrl(settingsQuery.data.haUrl ?? "");
      setHaToken(settingsQuery.data.haToken ?? "");
    }
  }, [settingsQuery.data]);

  // Units
  const [units, setUnits] = useState<"metric" | "imperial">("metric");

  // Analysis settings
  const [taskQuantity, setTaskQuantity] = useState<"low" | "normal" | "high">("normal");
  const [gardeningDays, setGardeningDays] = useState<number[]>([]);
  const [extraInstructions, setExtraInstructions] = useState("");

  useEffect(() => {
    if (settingsQuery.data?.units) {
      setUnits(settingsQuery.data.units);
    }
    if (settingsQuery.data?.taskQuantity) {
      setTaskQuantity(settingsQuery.data.taskQuantity);
    }
    if (settingsQuery.data?.gardeningDays) {
      setGardeningDays(settingsQuery.data.gardeningDays);
    }
    if (settingsQuery.data?.extraInstructions !== undefined) {
      setExtraInstructions(settingsQuery.data.extraInstructions ?? "");
    }
  }, [settingsQuery.data]);

  // API key form
  const [newKeyProvider, setNewKeyProvider] = useState<"claude" | "kimi">(
    "claude",
  );
  const [newKeyValue, setNewKeyValue] = useState("");

  // Mutations
  const createGardenMutation = trpc.gardens.create.useMutation({
    onSuccess() {
      gardensQuery.refetch();
    },
  });

  const updateGardenMutation = trpc.gardens.update.useMutation({
    onSuccess() {
      gardensQuery.refetch();
    },
  });

  const updateSettingsMutation = trpc.users.updateSettings.useMutation({
    onSuccess() {
      settingsQuery.refetch();
    },
  });

  const storeKeyMutation = trpc.apiKeys.store.useMutation({
    onSuccess() {
      apiKeysQuery.refetch();
      setNewKeyValue("");
    },
  });

  const deleteKeyMutation = trpc.apiKeys.delete.useMutation({
    onSuccess() {
      apiKeysQuery.refetch();
    },
  });

  const deleteGardenMutation = trpc.gardens.delete.useMutation({
    async onSuccess() {
      await utils.gardens.list.invalidate();
      router.push("/onboarding");
    },
  });

  if (!isAuthenticated) return null;

  const apiKeys = apiKeysQuery.data ?? [];

  const handleSaveGarden = () => {
    const lat = locationLat ? parseFloat(locationLat) : undefined;
    const lng = locationLng ? parseFloat(locationLng) : undefined;

    if (garden) {
      updateGardenMutation.mutate({
        id: garden.id,
        name: gardenName || undefined,
        hardinessZone: hardinessZone || undefined,
        locationLat: lat,
        locationLng: lng,
      });
    } else {
      createGardenMutation.mutate({
        name: gardenName || "My Garden",
        hardinessZone: hardinessZone || undefined,
        locationLat: lat,
        locationLng: lng,
      });
    }
  };

  const handleSaveHA = () => {
    updateSettingsMutation.mutate({
      haUrl: haUrl || undefined,
      haToken: haToken || undefined,
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Garden Config */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Garden Configuration
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Garden Name
            </label>
            <input
              value={gardenName}
              onChange={(e) => setGardenName(e.target.value)}
              placeholder="My Garden"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Hardiness Zone
              </label>
              <input
                value={hardinessZone}
                onChange={(e) => setHardinessZone(e.target.value)}
                placeholder="e.g. 7b"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Latitude
              </label>
              <input
                value={locationLat}
                onChange={(e) => setLocationLat(e.target.value)}
                placeholder="e.g. 37.77"
                type="number"
                step="any"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Longitude
              </label>
              <input
                value={locationLng}
                onChange={(e) => setLocationLng(e.target.value)}
                placeholder="e.g. -122.42"
                type="number"
                step="any"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
              />
            </div>
          </div>

          <button
            onClick={handleSaveGarden}
            disabled={
              updateGardenMutation.isPending || createGardenMutation.isPending
            }
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {updateGardenMutation.isPending || createGardenMutation.isPending
              ? "Saving..."
              : garden
                ? "Update Garden"
                : "Create Garden"}
          </button>

          {(updateGardenMutation.isSuccess ||
            createGardenMutation.isSuccess) && (
            <p className="text-sm text-green-600">Saved successfully.</p>
          )}
        </div>
      </section>

      {/* Units */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Units</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setUnits("metric");
              updateSettingsMutation.mutate({ units: "metric" });
            }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              units === "metric"
                ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Metric (°C, km/h, mm)
          </button>
          <button
            onClick={() => {
              setUnits("imperial");
              updateSettingsMutation.mutate({ units: "imperial" });
            }}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              units === "imperial"
                ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            Imperial (°F, mph, in)
          </button>
        </div>
      </section>

      {/* Task Quantity */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Task Quantity
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Control how many tasks the AI generates during daily analysis.
        </p>
        <div className="flex gap-2">
          {([
            { value: "low" as const, label: "Low", desc: "Only urgent items" },
            { value: "normal" as const, label: "Normal", desc: "Balanced mix" },
            { value: "high" as const, label: "High", desc: "Comprehensive" },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setTaskQuantity(opt.value);
                updateSettingsMutation.mutate({ taskQuantity: opt.value });
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-center transition-colors ${
                taskQuantity === opt.value
                  ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs opacity-75">{opt.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Gardening Days */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Gardening Days
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Select the days you garden. Tasks will be scheduled on these days only.
          Leave empty for any day.
        </p>
        <div className="flex gap-1.5">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
            (day, idx) => {
              const isActive = gardeningDays.includes(idx);
              return (
                <button
                  key={day}
                  onClick={() => {
                    const next = isActive
                      ? gardeningDays.filter((d) => d !== idx)
                      : [...gardeningDays, idx].sort((a, b) => a - b);
                    setGardeningDays(next);
                    updateSettingsMutation.mutate({ gardeningDays: next });
                  }}
                  className={`flex-1 rounded-lg border py-2 text-center text-sm font-medium transition-colors ${
                    isActive
                      ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                      : "border-gray-300 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {day}
                </button>
              );
            },
          )}
        </div>
      </section>

      {/* Extra Instructions */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Extra Instructions
        </h2>
        <p className="mb-3 text-sm text-gray-500">
          Custom instructions for the AI analysis (max 500 characters).
        </p>
        <textarea
          value={extraInstructions}
          onChange={(e) => setExtraInstructions(e.target.value.slice(0, 500))}
          placeholder="e.g., I'm organic-only, no chemical treatments"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {extraInstructions.length}/500
          </span>
          <button
            onClick={() =>
              updateSettingsMutation.mutate({
                extraInstructions: extraInstructions || "",
              })
            }
            disabled={updateSettingsMutation.isPending}
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {updateSettingsMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      {/* API Keys */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">API Keys</h2>

        {/* Existing keys */}
        {apiKeys.length > 0 && (
          <div className="mb-4 space-y-2">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
              >
                <div>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                    {key.provider}
                  </span>
                  <span className="ml-3 text-sm text-gray-500">
                    Added{" "}
                    {key.createdAt
                      ? new Date(key.createdAt).toLocaleDateString()
                      : "N/A"}
                  </span>
                </div>
                <button
                  onClick={() => deleteKeyMutation.mutate({ id: key.id })}
                  disabled={deleteKeyMutation.isPending}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new key */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setNewKeyProvider("claude")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                newKeyProvider === "claude"
                  ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Claude
            </button>
            <button
              onClick={() => setNewKeyProvider("kimi")}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                newKeyProvider === "kimi"
                  ? "border-[#2D7D46] bg-green-50 text-[#2D7D46]"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Kimi
            </button>
          </div>

          {newKeyProvider === "claude" ? (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <p className="font-medium text-gray-800">Claude by Anthropic</p>
              <p className="mt-1">
                Advanced AI for plant analysis and care recommendations.
                Requires an API key from Anthropic.
              </p>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[#2D7D46] hover:underline"
              >
                Get your API key &rarr;
              </a>
            </div>
          ) : (
            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              <p className="font-medium text-gray-800">Kimi by Moonshot AI</p>
              <p className="mt-1">
                Multilingual AI with strong vision capabilities. A good
                alternative if you don&apos;t have a Claude key.
              </p>
              <a
                href="https://platform.moonshot.ai/console/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[#2D7D46] hover:underline"
              >
                Get your API key &rarr;
              </a>
            </div>
          )}

          <input
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            placeholder={
              newKeyProvider === "claude" ? "sk-ant-..." : "sk-..."
            }
            type="password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
          />
          <button
            onClick={() => {
              if (!newKeyValue.trim()) return;
              storeKeyMutation.mutate({
                provider: newKeyProvider,
                key: newKeyValue.trim(),
              });
            }}
            disabled={storeKeyMutation.isPending || !newKeyValue.trim()}
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {storeKeyMutation.isPending ? "Saving..." : "Add Key"}
          </button>
        </div>
      </section>

      {/* Home Assistant */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Home Assistant
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              HA URL
            </label>
            <input
              value={haUrl}
              onChange={(e) => setHaUrl(e.target.value)}
              placeholder="http://homeassistant.local:8123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Long-Lived Access Token
            </label>
            <input
              value={haToken}
              onChange={(e) => setHaToken(e.target.value)}
              placeholder="Bearer token"
              type="password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2D7D46] focus:outline-none focus:ring-1 focus:ring-[#2D7D46]"
            />
          </div>
          <button
            onClick={handleSaveHA}
            disabled={updateSettingsMutation.isPending}
            className="rounded-lg bg-[#2D7D46] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#246838] disabled:opacity-50"
          >
            {updateSettingsMutation.isPending ? "Saving..." : "Save HA Config"}
          </button>
          {updateSettingsMutation.isSuccess && (
            <p className="text-sm text-green-600">Saved successfully.</p>
          )}
        </div>
      </section>

      {/* Danger Zone */}
      {garden && (
        <section className="rounded-xl border border-red-200 bg-white p-5">
          <h2 className="mb-2 text-lg font-semibold text-red-600">
            Danger Zone
          </h2>
          <p className="mb-4 text-sm text-gray-600">
            Delete your garden and all its zones, plants, and data. This will
            restart the onboarding wizard.
          </p>
          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
            >
              Reset Garden
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => deleteGardenMutation.mutate({ id: garden.id })}
                disabled={deleteGardenMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {deleteGardenMutation.isPending
                  ? "Deleting..."
                  : "Yes, delete everything"}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
