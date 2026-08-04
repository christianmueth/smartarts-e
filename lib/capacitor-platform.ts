"use client";

type CapacitorRuntime = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

export function isCapacitorAndroid() {
  if (typeof window === "undefined") return false;
  const capacitor = (window as Window & { Capacitor?: CapacitorRuntime }).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === "android");
}