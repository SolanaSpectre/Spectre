'use strict';

const assert = require('assert');
const { createRequire } = require('module');
const { PublicKey } = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('../src/lib/spl-token-primitives');
const { PumpBuyV2DryRunBuilder } = require('../src/lib/pump-buy-v2-dry-run-builder');

const owner = new PublicKey('GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB');
const payer = new PublicKey('J2xccRtuG43drESLYznHhLhQkLTdfepcKYbiQ9BsJVaf');
const offCurveOwner = new PublicKey('3ce4qeC75RFUZhdop5pEQMxgti1pqL6tRLrJJFvQnokV');
const mint = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

assert.strictEqual(TOKEN_PROGRAM_ID.toBase58(), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
assert.strictEqual(TOKEN_2022_PROGRAM_ID.toBase58(), 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
assert.strictEqual(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
assert.strictEqual(NATIVE_MINT.toBase58(), 'So11111111111111111111111111111111111111112');

const classicAta = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
const token2022Ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
const offCurveAta = getAssociatedTokenAddressSync(mint, offCurveOwner, true, TOKEN_PROGRAM_ID);

assert.strictEqual(classicAta.toBase58(), 'D9Rsc81iPd5iDaLoNLqWXDKjN7tNUwL6SE9GQB4Q1jEg');
assert.strictEqual(token2022Ata.toBase58(), 'DxmmEJoo6gbtLMSmnoRVvJR6mB6kHUWqiVWRCodFYVmH');
assert.strictEqual(offCurveAta.toBase58(), '3urv3qaNhLraWq5LcDG6LsdWPpwA7M9qF1Q39LKM1FWm');
assert.throws(
  () => getAssociatedTokenAddressSync(mint, offCurveOwner, false, TOKEN_PROGRAM_ID),
  /off curve/
);

const associatedInstruction = createAssociatedTokenAccountIdempotentInstruction(
  payer,
  classicAta,
  owner,
  mint,
  TOKEN_PROGRAM_ID
);
assert.strictEqual(associatedInstruction.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
assert.strictEqual(associatedInstruction.data.toString('hex'), '01');
assert.deepStrictEqual(
  associatedInstruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
    pubkey: pubkey.toBase58(),
    isSigner,
    isWritable,
  })),
  [
    { pubkey: payer.toBase58(), isSigner: true, isWritable: true },
    { pubkey: classicAta.toBase58(), isSigner: false, isWritable: true },
    { pubkey: owner.toBase58(), isSigner: false, isWritable: false },
    { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
    { pubkey: '11111111111111111111111111111111', isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
  ]
);

const syncInstruction = createSyncNativeInstruction(classicAta, TOKEN_PROGRAM_ID);
assert.strictEqual(syncInstruction.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
assert.strictEqual(syncInstruction.data.toString('hex'), '11');
assert.deepStrictEqual(
  syncInstruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
    pubkey: pubkey.toBase58(),
    isSigner,
    isWritable,
  })),
  [{ pubkey: classicAta.toBase58(), isSigner: false, isWritable: true }]
);

const built = new PumpBuyV2DryRunBuilder({ liveDryRunBuySlippageBps: 1500 }).build({
  mint: mint.toBase58(),
  user: owner,
  creator: payer.toBase58(),
  quote: {
    estimatedTokensOut: 123.456789,
    amountLamports: 1_000_000,
  },
  blockhash: payer.toBase58(),
  mintOwner: TOKEN_PROGRAM_ID.toBase58(),
});
assert.strictEqual(built.ok, true);
assert.strictEqual(built.setupInstructionCount, 4);
assert.strictEqual(built.accountCount, 27);
assert.strictEqual(built.transaction.instructions.length, 5);
assert.strictEqual(built.transaction.instructions[0].data.toString('hex'), '01');
assert.strictEqual(built.transaction.instructions[1].data.toString('hex'), '01');
assert.strictEqual(built.transaction.instructions[3].data.toString('hex'), '11');
assert.strictEqual(built.associatedBaseUser, classicAta.toBase58());
assert.strictEqual(built.baseTokenProgram, TOKEN_PROGRAM_ID.toBase58());
assert.strictEqual(built.quoteMint, NATIVE_MINT.toBase58());
assert.strictEqual(built.minTokensOutRaw, '104938270');
assert.strictEqual(built.maxQuoteLamports, '1150000');

const jaysonRequire = createRequire(require.resolve('jayson/package.json'));
const patchedUuidPackage = require(jaysonRequire.resolve('uuid/package.json'));
assert.strictEqual(patchedUuidPackage.version, '11.1.1');
assert.strictEqual(typeof jaysonRequire('uuid').v4, 'function');

assert.throws(() => require.resolve('@solana/spl-token'), /Cannot find module/);

console.log('Solana dependency compatibility smoke passed');
