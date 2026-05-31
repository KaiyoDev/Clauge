// ─────────────────────────────────────────────────────────────────────────────
// Bản local thuần (Clauge Việt): toàn bộ tầng Cloud/Đăng nhập/Pro đã được gỡ bỏ.
//
// File này chỉ còn là một "shim" giữ lại các type + store ở trạng thái inert
// (luôn ngắt kết nối, không Pro-gate) để các component cũ còn import vẫn biên
// dịch được mà không cần sửa hàng loạt. Không có bất kỳ lệnh gọi mạng nào ra
// ngoài; dữ liệu của người dùng luôn nằm trên máy.
//
// Quy ước:
//   • cloudConnected luôn = false (không có tài khoản).
//   • cloudUser / cloudProviders / activeProvider luôn rỗng.
//   • cloudConflicts luôn rỗng (không đồng bộ → không xung đột).
//   • Các hàm setConnected/setDisconnected/markSynced... giữ chữ ký cũ nhưng
//     là no-op để call site cũ không vỡ.
// ─────────────────────────────────────────────────────────────────────────────

import { writable, readable } from 'svelte/store';

export type Provider = 'github' | 'google';

export interface CloudUser {
  userId: number;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  slug: string;
  createdAt: string | null;
}

export type CloudSubscriptionSnapshot = {
  status: string;
  cancelAtPeriodEnd: boolean;
  isLifetime: boolean;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  interval: 'monthly' | 'yearly' | 'lifetime' | null;
  priceUsd: number | null;
} | null;

export interface CloudProviderLink {
  provider: Provider;
  providerUserId: string;
  providerLogin: string | null;
  email: string | null;
  linkedAt: string;
  lastSeenAt: string;
}

export type ProStateCredits = {
  remaining: number;
  allowance: number;
  resets_at: string | null;
};

export type ProStateSubscription = {
  status: string;
  cancel_at_period_end: boolean;
  is_lifetime: boolean;
  current_period_end: string | null;
  current_period_start: string | null;
  interval: 'monthly' | 'yearly' | 'lifetime' | null;
  price_usd: number | null;
};

export type ProState = {
  plan: string;
  credits: ProStateCredits | null;
  subscription: ProStateSubscription | null;
};

export type CloudCreditsSnapshot = {
  remaining: number;
  allowance: number;
  resetsAt: string | null;
} | null;

// ─── Identity stores — luôn ở trạng thái ngắt kết nối (local thuần) ──────────

export const cloudConnected = readable<boolean>(false);
export const cloudUser = readable<CloudUser | null>(null);
export const cloudProviders = readable<CloudProviderLink[]>([]);
export const activeProvider = readable<Provider | null>(null);
export const cloudConflicts = readable<string[]>([]);
export const cloudDisplayHandle = readable<{
  handle: string;
  avatarUrl: string | null;
  provider: Provider | null;
} | null>(null);

// ─── Entitlement — đã mở khóa toàn bộ tính năng ("pro" vĩnh viễn, miễn phí) ──
//
// Mọi gate cũ kiểm tra `$cloudPlan === 'pro'` đã được gỡ ở các component, nhưng
// để chắc chắn không còn chỗ nào khóa tính năng, mặc định trả 'pro'.

export const cloudPlan = readable<string>('pro');
export const cloudCredits = readable<CloudCreditsSnapshot>(null);
export const cloudSub = readable<CloudSubscriptionSnapshot>(null);

// ─── Các store/biến UI cũ — giữ để tương thích, đều inert ───────────────────

export const lastSyncedByKind = readable<Record<string, string>>({});
export const syncing = readable<boolean>(false);
export const hasSyncedOnce = readable<boolean>(true);
export const showSyncRestorePrompt = writable<boolean>(false);

// ─── No-op mutators (giữ chữ ký cũ cho call site còn sót) ────────────────────

export function setConnected(
  _user: CloudUser,
  _providers: CloudProviderLink[],
  _active: Provider | null,
  _plan_unused?: string,
) {
  /* local thuần: không có tài khoản để kết nối */
}

export function setDisconnected() {
  /* local thuần: không có gì để ngắt */
}

export function setSyncing(_value: boolean) {
  /* no-op */
}

export function setLastSyncedForKinds(_map: Record<string, string>) {
  /* no-op */
}

export function markSynced() {
  /* no-op */
}
