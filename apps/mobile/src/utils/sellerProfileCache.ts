import type { SellerProfile } from "../screens/SellerProfileDetailScreen";

let profileCache: SellerProfile | null = null;
let meCache: { fullName: string; dob: string; countryCode: string; nationalId: string; email: string } | null = null;

export function getSellerProfileCache(): SellerProfile | null {
  return profileCache;
}

export function setSellerProfileCache(p: SellerProfile | null): void {
  profileCache = p;
}

export function getSellerMeCache(): typeof meCache {
  return meCache;
}

export function setSellerMeCache(m: typeof meCache): void {
  meCache = m;
}
