/**
 * token-store.ts — In-memory store for refresh token rotation and revocation.
 *
 * Tracks issued refresh tokens and their rotation state. Refresh tokens are
 * single-use: exchanging a refresh token for a new access token invalidates
 * the old refresh token and issues a new one (rotation). All tokens are
 * checked against the revocation list before being accepted.
 *
 * For a single-process deployment this in-memory store is sufficient.
 * Multi-process / multi-instance deployments should back this with Redis
 * or a shared datastore (SqliteTokenStore is a future TODO).
 */

import type { RefreshTokenRecord } from "@/types/types.ts";
import { REFRESH_TOKEN_TTL_SECONDS } from "./jwt.ts";

export class TokenStore {
	private refreshTokens = new Map<string, RefreshTokenRecord>();
	store(
		thumbprint: string,
		subject: string,
		agents: string[],
		ttlSeconds: number = REFRESH_TOKEN_TTL_SECONDS,
	): RefreshTokenRecord {
		const record: RefreshTokenRecord = {
			thumbprint,
			subject,
			agents,
			expiresAt: Math.floor(Date.now() / 1000) + Math.max(0, ttlSeconds),
			revoked: false,
		};
		this.refreshTokens.set(thumbprint, record);
		return record;
	}

	/**
	 * Look up a refresh token by thumbprint.
	 */
	get(thumbprint: string): RefreshTokenRecord | undefined {
		return this.refreshTokens.get(thumbprint);
	}

	/**
	 * Rotate a refresh token: mark the old one as revoked, store a new one.
	 *
	 * Refresh token rotation means each refresh token can be used exactly
	 * once. When the client exchanges a refresh token for a new access
	 * token, the old refresh token is invalidated and a new refresh token
	 * is issued alongside the new access token.
	 *
	 * @returns The new refresh token record, or null if the old token
	 *          was already revoked (possible replay attack — caller should
	 *          revoke ALL tokens for this subject).
	 */
	rotate(
		oldThumbprint: string,
		newThumbprint: string,
		ttlSeconds: number = REFRESH_TOKEN_TTL_SECONDS,
	): RefreshTokenRecord | null {
		const old = this.refreshTokens.get(oldThumbprint);
		if (!old) return null;

		// If the old token was already revoked, this is a replay attack.
		// The caller must revoke all tokens for this subject.
		if (old.revoked) {
			return null;
		}

		// Mark old token as revoked.
		old.revoked = true;

		// Store new record, linking to parent.
		const newRecord: RefreshTokenRecord = {
			thumbprint: newThumbprint,
			subject: old.subject,
			agents: old.agents,
			expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
			revoked: false,
			parent: oldThumbprint,
		};
		this.refreshTokens.set(newThumbprint, newRecord);
		return newRecord;
	}

	/**
	 * Revoke a refresh token by thumbprint.
	 */
	revoke(thumbprint: string): boolean {
		const record = this.refreshTokens.get(thumbprint);
		if (!record) return false;
		record.revoked = true;
		return true;
	}

	/**
	 * Revoke ALL tokens for a subject (used when a replay attack is detected
	 * or when a user explicitly logs out everywhere).
	 */
	revokeAllForSubject(subject: string): number {
		let count = 0;
		for (const record of this.refreshTokens.values()) {
			if (record.subject === subject) {
				record.revoked = true;
				count++;
			}
		}
		return count;
	}

	/**
	 * Check whether a thumbprint is in the revocation list (revoked or expired).
	 */
	isRevoked(thumbprint: string): boolean {
		const record = this.refreshTokens.get(thumbprint);
		if (!record) return true;
		if (record.revoked) return true;
		if (record.expiresAt < Math.floor(Date.now() / 1000)) return true;
		return false;
	}

	/**
	 * Sweep expired records from the store.
	 * Returns the number of records removed.
	 */
	sweep(): number {
		const now = Math.floor(Date.now() / 1000);
		let removed = 0;
		for (const [tp, record] of this.refreshTokens) {
			if (record.expiresAt <= now) {
				this.refreshTokens.delete(tp);
				removed++;
			}
		}
		return removed;
	}

	/**
	 * Return the number of active (non-expired) tokens in the store.
	 */
	get size(): number {
		const now = Math.floor(Date.now() / 1000);
		let count = 0;
		for (const record of this.refreshTokens.values()) {
			if (record.expiresAt >= now) count++;
		}
		return count;
	}
}

// ---------------------------------------------------------------------------
// Singleton for the server process
// ---------------------------------------------------------------------------

let _globalStore: TokenStore | null = null;

export function getTokenStore(): TokenStore {
	if (!_globalStore) {
		_globalStore = new TokenStore();
	}
	return _globalStore;
}
