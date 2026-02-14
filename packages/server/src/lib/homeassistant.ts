export async function fetchSensorState(
  haUrl: string,
  haToken: string,
  entityId: string,
): Promise<{
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
}> {
  const res = await fetch(`${haUrl}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${haToken}` },
  });
  if (!res.ok) throw new Error(`HA API error: ${res.status}`);
  return res.json() as Promise<{
    state: string;
    attributes: Record<string, unknown>;
    lastChanged: string;
  }>;
}

export async function fetchWeatherFromHA(
  haUrl: string,
  haToken: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  return fetchSensorState(haUrl, haToken, entityId);
}
