// Pinterest pin queue (server/src/pinterest.ts).
import { request } from "./api";
import type { PinterestPin, PinterestSettings, PinterestStatus } from "./types";

export type PinPatch = Partial<Pick<PinterestPin, "title" | "description" | "link" | "board" | "altText" | "scheduledAt">>;

export const pinterestApi = {
  status: (brandId: string) => request<PinterestStatus>("GET", `/api/brands/${brandId}/pinterest`),
  save: (brandId: string, s: Partial<PinterestSettings>) => request<PinterestStatus>("PATCH", `/api/brands/${brandId}/pinterest`, s),
  run: (brandId: string) => request<{ created: PinterestPin[]; summary: string }>("POST", `/api/brands/${brandId}/pinterest/run`, {}),
  fromListing: (brandId: string, listingId: string, layout?: string) => request<{ pins: PinterestPin[] }>("POST", `/api/brands/${brandId}/pinterest/pins`, { listingId, layout }),
  fromPost: (brandId: string, postId: string) => request<{ pins: PinterestPin[] }>("POST", `/api/brands/${brandId}/pinterest/pins`, { postId }),
  pins: (brandId: string) => request<PinterestPin[]>("GET", `/api/pinterest/pins?brandId=${encodeURIComponent(brandId)}`),
  update: (id: string, p: PinPatch) => request<PinterestPin>("PATCH", `/api/pinterest/pins/${id}`, p),
  approve: (id: string) => request<PinterestPin>("POST", `/api/pinterest/pins/${id}/approve`, {}),
  skip: (id: string) => request<PinterestPin>("POST", `/api/pinterest/pins/${id}/skip`, {}),
  rerender: (id: string) => request<PinterestPin>("POST", `/api/pinterest/pins/${id}/rerender`, {}),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/api/pinterest/pins/${id}`),
  instructions: () => request<{ instructions: string }>("GET", `/api/pinterest/instructions`),
};
