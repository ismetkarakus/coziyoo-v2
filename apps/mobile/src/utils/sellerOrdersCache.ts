type SellerOrderCacheItem = Record<string, unknown>;

let sellerOrdersCache: SellerOrderCacheItem[] | null = null;
let sellerDisplayNameCache: string | null = null;

export function getSellerOrdersCache(): SellerOrderCacheItem[] | null {
  return sellerOrdersCache;
}

export function setSellerOrdersCache(items: SellerOrderCacheItem[] | null): void {
  sellerOrdersCache = Array.isArray(items) ? items : null;
}

export function getSellerDisplayNameCache(): string | null {
  return sellerDisplayNameCache;
}

export function setSellerDisplayNameCache(name: string): void {
  sellerDisplayNameCache = name || null;
}
