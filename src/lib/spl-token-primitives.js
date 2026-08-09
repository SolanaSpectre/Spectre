'use strict';

const {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} = require('@solana/web3.js');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');

function getAssociatedTokenAddressSync(
  mint,
  owner,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
) {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new Error('Token owner is off curve');
  }

  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  )[0];
}

function createAssociatedTokenAccountIdempotentInstruction(
  payer,
  associatedToken,
  owner,
  mint,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
) {
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    programId: associatedTokenProgramId,
    data: Buffer.from([1]),
  });
}

function createSyncNativeInstruction(account, programId = TOKEN_PROGRAM_ID) {
  return new TransactionInstruction({
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    programId,
    data: Buffer.from([17]),
  });
}

module.exports = {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
};
