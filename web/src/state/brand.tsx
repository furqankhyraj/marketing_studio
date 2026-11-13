import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Brand } from "../lib/types";

type Ctx = {
  brands: Brand[];
  brand: Brand | undefined;
  brandId: string | undefined;
  loading: boolean;
  error: unknown;
  setBrandId: (id: string) => void;
  refresh: () => Promise<void>;
  upsert: (b: Brand) => void;
};
const BrandCtx = createContext<Ctx>(null as unknown as Ctx);
const KEY = "sms-brand";

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [brandId, setId] = useState<string | undefined>(() => {
    try { return localStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
  });

  const setBrandId = useCallback((id: string) => {
    setId(id);
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.brands();
      setBrands(list);
      setError(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Retry every 10s while the API is down so the UI recovers once the server starts.
  useEffect(() => {
    if (!error) return;
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [error, refresh]);

  const upsert = useCallback((b: Brand) => {
    setBrands((list) => (list.some((x) => x.id === b.id) ? list.map((x) => (x.id === b.id ? b : x)) : [...list, b]));
  }, []);

  const brand = useMemo(() => brands.find((b) => b.id === brandId) ?? brands[0], [brands, brandId]);
  return (
    <BrandCtx.Provider value={{ brands, brand, brandId: brand?.id, loading, error, setBrandId, refresh, upsert }}>
      {children}
    </BrandCtx.Provider>
  );
}
export const useBrands = () => useContext(BrandCtx);
