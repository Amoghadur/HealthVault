import { ethers } from 'ethers';

export const CONTRACT_ADDRESS = import.meta.env?.VITE_CONTRACT_ADDRESS || '0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39';
export const SEPOLIA_CHAIN_ID = 11155111n;
export function transactionError(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return 'Transaction cancelled in your wallet. No blockchain confirmation was recorded.';
  if (error.code === 'CALL_EXCEPTION') return 'The transaction failed or was reverted. Check your access and try again.';
  return error.shortMessage || error.message || 'The transaction could not be completed.';
}

export async function waitForSuccess(transaction) {
  let receipt;
  try { receipt = await transaction.wait(); }
  catch (error) {
    if (error.code !== 'TRANSACTION_REPLACED' || error.cancelled) throw error;
    receipt = error.receipt;
  }
  if (!receipt || Number(receipt.status) !== 1) throw new Error('Transaction failed. No successful confirmation was received.');
  return receipt;
}

export async function assertSepolia(provider) {
  if ((await provider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) throw new Error('Select Ethereum Sepolia in MetaMask to continue.');
}

export async function walletContract(abi, account) {
  if (!window.ethereum) throw new Error('MetaMask is required.');
  const provider = new ethers.BrowserProvider(window.ethereum);
  await assertSepolia(provider);
  const signer = await provider.getSigner();
  if (account && (await signer.getAddress()).toLowerCase() !== account.toLowerCase()) throw new Error('Your wallet account changed. Sign out and reconnect.');
  return new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
}
