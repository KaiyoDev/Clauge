// ─────────────────────────────────────────────────────────────────────────────
// Bản local thuần (Clauge Việt): backend Cloud đã được gỡ bỏ hoàn toàn.
//
// File này chỉ còn là shim offline — giữ nguyên chữ ký các hàm cũ để call site
// không vỡ, nhưng KHÔNG còn bất kỳ lệnh gọi mạng nào ra clauge.in. Mọi hàm trả
// về trạng thái "ngắt kết nối / không có dữ liệu đám mây".
// ─────────────────────────────────────────────────────────────────────────────

import type { CloudUser, CloudProviderLink, Provider, ProState } from '$lib/stores/cloud';

export interface CloudEntitlements {
  plan: string;
  credits?: {
    remaining: number;
    allowance: number;
    resets_at: string | null;
  };
  subscription?: {
    status: string;
    cancel_at_period_end: boolean;
    is_lifetime?: boolean;
    current_period_end?: string | null;
    current_period_start?: string | null;
    interval?: 'monthly' | 'yearly' | 'lifetime' | null;
    price_usd?: number | null;
  };
}

export interface CloudStatus {
  connected: boolean;
  activeProvider: Provider | null;
  user: CloudUser | null;
  providers: CloudProviderLink[];
  plan: string;
  lastSynced: Record<string, string>;
  entitlements?: CloudEntitlements;
}

export interface MissingCredentials {
  ssh: string[];
  sql: string[];
  nosql: string[];
  explorer: string[];
}

const DISCONNECTED: CloudStatus = {
  connected: false,
  activeProvider: null,
  user: null,
  providers: [],
  plan: 'pro', // mọi tính năng đã mở khóa
  lastSynced: {},
};

export const cloudGetStatus = async (): Promise<CloudStatus> => DISCONNECTED;

export const cloudProbeMissingCredentials = async (): Promise<MissingCredentials> => ({
  ssh: [],
  sql: [],
  nosql: [],
  explorer: [],
});

export const cloudGithubLoginUrl = async (): Promise<string> => '';
export const cloudGoogleLoginUrl = async (): Promise<string> => '';

export const cloudExchangeCode = async (
  _provider: Provider,
  _code: string,
): Promise<CloudStatus> => DISCONNECTED;

export const cloudLinkProvider = async (
  _provider: Provider,
  _code: string,
): Promise<CloudStatus> => DISCONNECTED;

export const cloudUnlinkProvider = async (_provider: Provider): Promise<CloudStatus> =>
  DISCONNECTED;

export const cloudUpdateProfile = async (_fields: {
  displayName?: string;
  firstName?: string;
  lastName?: string;
}): Promise<CloudStatus> => DISCONNECTED;

export const cloudCheckRemoteExists = async (): Promise<boolean> => false;
export const cloudSyncPushNow = async (): Promise<string[]> => [];
export const cloudSyncRestore = async (): Promise<string[]> => [];
export const cloudGetConflicts = async (): Promise<string[]> => [];
export const cloudResolveKeepLocal = async (): Promise<void> => {};
export const cloudResolveUseRemote = async (): Promise<void> => {};
export const cloudPullIfRemoteNewer = async (): Promise<string[]> => [];
export const cloudLocalHasData = async (): Promise<boolean> => false;
export const cloudLogout = async (): Promise<void> => {};
export const cloudWipeRemote = async (): Promise<void> => {};
export const cloudDeleteAccount = async (_confirmationSlug: string): Promise<void> => {};

/** Trạng thái Pro vĩnh viễn (local thuần — mọi tính năng đã mở khóa). */
export const proStateCurrent = async (): Promise<ProState> => ({
  plan: 'pro',
  credits: null,
  subscription: null,
});
