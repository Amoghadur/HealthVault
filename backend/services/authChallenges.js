import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';

export function createChallengeStore({ now = Date.now, ttlMs = 5 * 60 * 1000, origin = 'http://localhost:5173' } = {}) {
  const challenges = new Map();
  function wallet(address) {
    if (typeof address !== 'string' || !ethers.isAddress(address)) throw new Error('A valid wallet address is required.');
    return address.toLowerCase();
  }
  return {
    issue(address) {
      const normalized = wallet(address);
      const issuedAt = now();
      for (const [key, entry] of challenges) if (entry.expiresAt <= issuedAt) challenges.delete(key);
      if (challenges.size >= 10000 && !challenges.has(normalized)) throw new Error('Sign-in is busy. Try again shortly.');
      const nonce = randomBytes(32).toString('hex');
      const expiresAt = issuedAt + ttlMs;
      const message = `Welcome to HealthVault!\n\nSign in to ${origin}\nSigning proves you own this wallet. No transaction. No fees.\n\nWallet: ${normalized}\nChain ID: 11155111\nNonce: ${nonce}\nIssued at: ${new Date(issuedAt).toISOString()}\nExpires at: ${new Date(expiresAt).toISOString()}`;
      const challenge = { nonce, message, expiresAt };
      challenges.set(normalized, challenge);
      return { ...challenge };
    },
    verifyAndConsume(address, signature) {
      const normalized = wallet(address);
      const challenge = challenges.get(normalized);
      if (!challenge) throw new Error('Sign-in challenge not found or already used. Connect again.');
      if (now() >= challenge.expiresAt) {
        challenges.delete(normalized);
        throw new Error('Sign-in challenge expired. Connect again.');
      }
      let recovered;
      try { recovered = ethers.verifyMessage(challenge.message, signature); }
      catch { throw new Error('Invalid sign-in signature.'); }
      if (recovered.toLowerCase() !== normalized) throw new Error('Signature does not match the intended wallet and challenge.');
      // Synchronous verification and deletion prevent concurrent consumption.
      challenges.delete(normalized);
      return normalized;
    },
  };
}
