// Etsy shop endpoints (server/src/etsy.ts). Uses the shared request() so ?mock=1 works (mock: lib/mockEtsy.ts).
import { request } from "./api";
import type { Automation, Brand, EtsyListing, EtsyStatus, Post, PostType } from "./types";

export type EtsyCreateBody = { types?: PostType[]; render?: boolean; style?: string; automation?: boolean; keyword?: string };
export type EtsyCreateResult = { posts: Post[]; automations: Automation[]; listing?: EtsyListing; listings?: string[] };
export type EtsyManualBody = { url: string; title: string; price?: string; currency?: string; description?: string; tags?: string; assetIds?: string[] };

export const etsyApi = {
  status: (brandId: string) => request<EtsyStatus>("GET", `/api/brands/${brandId}/etsy`),
  setShop: (brandId: string, shop: string) => request<Brand>("PATCH", `/api/brands/${brandId}`, { etsyShop: shop }),
  startImport: (brandId: string, b: { shop?: string; limit?: number } = {}) => request<EtsyStatus>("POST", `/api/brands/${brandId}/etsy/import`, b),
  listings: (brandId: string) => request<EtsyListing[]>("GET", `/api/brands/${brandId}/etsy/listings`),
  addListing: (brandId: string, b: EtsyManualBody) => request<EtsyListing>("POST", `/api/brands/${brandId}/etsy/listings`, b),
  deleteListing: (brandId: string, listingId: string) => request<{ ok: true }>("DELETE", `/api/brands/${brandId}/etsy/listings/${listingId}`),
  createPosts: (brandId: string, listingId: string, b: EtsyCreateBody) => request<EtsyCreateResult>("POST", `/api/brands/${brandId}/etsy/listings/${listingId}/posts`, b),
  plan: (brandId: string, b: EtsyCreateBody & { count?: number }) => request<EtsyCreateResult>("POST", `/api/brands/${brandId}/etsy/plan`, b),
  feedBrain: (brandId: string) => request<Brand>("POST", `/api/brands/${brandId}/etsy/brain`),
};
