export class DataApiError extends Error {
  constructor(
    message: string,
    readonly code: "invalid-input" | "upstream",
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataApiError";
  }
}

export async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new DataApiError(
      "Could not reach the inspection data service. Check your connection and try again.",
      "upstream",
    );
  }
  if (!response.ok) {
    throw new DataApiError(
      response.status === 429
        ? "The inspection data service is busy. Please try again shortly."
        : `The inspection data service returned an error (HTTP ${response.status}).`,
      "upstream",
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new DataApiError(
      "The inspection data service returned an invalid response.",
      "upstream",
      response.status,
    );
  }
}

export function validateZip(zip: string): void {
  if (zip && !/^\d{5}$/.test(zip)) {
    throw new DataApiError(
      "Zip code must contain exactly 5 digits.",
      "invalid-input",
    );
  }
}

export function validateGeo(
  geo: { lat: number; lng: number; radius: number } | undefined,
): void {
  if (!geo) return;
  if (
    !Number.isFinite(geo.lat) ||
    !Number.isFinite(geo.lng) ||
    !Number.isFinite(geo.radius) ||
    geo.lat < -90 ||
    geo.lat > 90 ||
    geo.lng < -180 ||
    geo.lng > 180 ||
    geo.radius <= 0 ||
    geo.radius > 25
  ) {
    throw new DataApiError(
      "Location or search radius is invalid.",
      "invalid-input",
    );
  }
}
