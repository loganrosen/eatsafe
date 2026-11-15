import { useSyncExternalStore } from "react";

const STORAGE_KEY = "eatsafe:follows";

export interface FollowedRestaurant {
  camis: string;
  dba: string;
  followedAt: number;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedList: FollowedRestaurant[] = [];

function read(): FollowedRestaurant[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    cachedList = Array.isArray(parsed)
      ? parsed.filter(
          (f): f is FollowedRestaurant =>
            typeof f?.camis === "string" && typeof f?.dba === "string",
        )
      : [];
  } catch {
    cachedList = [];
  }
  return cachedList;
}

function write(list: FollowedRestaurant[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getFollows(): FollowedRestaurant[] {
  return read();
}

export function followRestaurant(camis: string, dba: string): void {
  const list = read();
  if (list.some((f) => f.camis === camis)) return;
  write([...list, { camis, dba, followedAt: Date.now() }]);
}

export function unfollowRestaurant(camis: string): void {
  write(read().filter((f) => f.camis !== camis));
}

export function useFollows(): FollowedRestaurant[] {
  return useSyncExternalStore(subscribe, read, () => []);
}
