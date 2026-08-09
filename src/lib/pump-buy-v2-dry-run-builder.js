'use strict';

const {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} = require('./spl-token-primitives');

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const BUY_V2_DISCRIMINATOR = Buffer.from([184, 23, 238, 97, 103, 197, 211, 61]);
const PUMP_TOKEN_DECIMALS = 6;

const NORMAL_FEE_RECIPIENTS = [
  '62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV',
  '7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ',
  '7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX',
  '9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz',
  'AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY',
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
  'FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz',
  'G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP',
];

const RESERVED_FEE_RECIPIENTS = [
  'GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS',
  '4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6',
  '8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR',
  '4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH',
  '8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6',
  'Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk',
  '463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq',
  '6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA',
];

const BUYBACK_FEE_RECIPIENTS = [
  '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD',
  '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7',
  'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL',
  '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
  '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6',
  'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL',
  '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD',
  'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW',
];

function pda(seeds, programId = PUMP_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function u64Buffer(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function tokenAmountToRaw(amountTokens) {
  const tokens = Number(amountTokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return 0n;
  return BigInt(Math.max(1, Math.floor(tokens * (10 ** PUMP_TOKEN_DECIMALS))));
}

class PumpBuyV2DryRunBuilder {
  constructor(config = {}) {
    this.programId = new PublicKey(config.pumpBondingCurveProgramId || PUMP_PROGRAM_ID);
    this.slippageBps = Math.max(0, Number(config.liveDryRunBuySlippageBps ?? 1500));
  }

  selectFeeRecipient(isMayhemMode) {
    const list = isMayhemMode ? RESERVED_FEE_RECIPIENTS : NORMAL_FEE_RECIPIENTS;
    return new PublicKey(list[0]);
  }

  selectBuybackFeeRecipient() {
    return new PublicKey(BUYBACK_FEE_RECIPIENTS[0]);
  }

  build({ mint, user, bondingCurveAddress, creator, isMayhemMode, quote, blockhash, mintOwner }) {
    if (!blockhash) {
      return { ok: false, reason: 'MISSING_BLOCKHASH' };
    }

    const baseMint = new PublicKey(mint);
    const userPubkey = user instanceof PublicKey ? user : new PublicKey(user);
    const expectedBondingCurve = pda([Buffer.from('bonding-curve'), baseMint.toBuffer()], this.programId);
    const providedBondingCurve = bondingCurveAddress ? new PublicKey(bondingCurveAddress) : null;
    if (providedBondingCurve && !providedBondingCurve.equals(expectedBondingCurve)) {
      return {
        ok: false,
        reason: 'BONDING_CURVE_ADDRESS_MISMATCH',
        expectedBondingCurveAddress: expectedBondingCurve.toBase58(),
        providedBondingCurveAddress: providedBondingCurve.toBase58()
      };
    }
    const bondingCurve = providedBondingCurve || expectedBondingCurve;
    const creatorPubkey = creator ? new PublicKey(creator) : null;
    if (!creatorPubkey) {
      return { ok: false, reason: 'MISSING_CREATOR' };
    }

    const baseTokenProgram = mintOwner ? new PublicKey(mintOwner) : TOKEN_2022_PROGRAM_ID;
    if (!baseTokenProgram.equals(TOKEN_PROGRAM_ID) && !baseTokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
      return { ok: false, reason: 'UNSUPPORTED_BASE_TOKEN_PROGRAM', baseTokenProgram: baseTokenProgram.toBase58() };
    }

    const quoteMint = NATIVE_MINT;
    const quoteTokenProgram = TOKEN_PROGRAM_ID;
    const feeRecipient = this.selectFeeRecipient(Boolean(isMayhemMode));
    const buybackFeeRecipient = this.selectBuybackFeeRecipient();
    const creatorVault = pda([Buffer.from('creator-vault'), creatorPubkey.toBuffer()], this.programId);
    const userVolumeAccumulator = pda([Buffer.from('user_volume_accumulator'), userPubkey.toBuffer()], this.programId);
    const associatedBaseUser = getAssociatedTokenAddressSync(baseMint, userPubkey, false, baseTokenProgram);
    const associatedQuoteUser = getAssociatedTokenAddressSync(quoteMint, userPubkey, false, quoteTokenProgram);
    const associatedBaseBondingCurve = getAssociatedTokenAddressSync(baseMint, bondingCurve, true, baseTokenProgram);
    const associatedQuoteBondingCurve = getAssociatedTokenAddressSync(quoteMint, bondingCurve, true, quoteTokenProgram);
    const associatedQuoteFeeRecipient = getAssociatedTokenAddressSync(quoteMint, feeRecipient, true, quoteTokenProgram);
    const associatedQuoteBuybackFeeRecipient = getAssociatedTokenAddressSync(quoteMint, buybackFeeRecipient, true, quoteTokenProgram);
    const associatedCreatorVault = getAssociatedTokenAddressSync(quoteMint, creatorVault, true, quoteTokenProgram);
    const associatedUserVolumeAccumulator = getAssociatedTokenAddressSync(quoteMint, userVolumeAccumulator, true, quoteTokenProgram);

    const expectedRaw = tokenAmountToRaw(quote?.estimatedTokensOut);
    if (expectedRaw <= 0n) {
      return { ok: false, reason: 'INVALID_ESTIMATED_TOKENS_OUT' };
    }
    const slippageMultiplierBps = Math.max(10000, 10000 + this.slippageBps);
    const minTokensOut = (expectedRaw * BigInt(Math.max(0, 10000 - this.slippageBps))) / 10000n;
    const quoteLamports = BigInt(Math.max(1, Math.ceil(Number(quote?.amountLamports || 0))));
    const maxQuoteLamports = (quoteLamports * BigInt(slippageMultiplierBps) + 9999n) / 10000n;
    if (minTokensOut <= 0n || maxQuoteLamports <= 0n) {
      return { ok: false, reason: 'INVALID_BUY_V2_AMOUNTS' };
    }

    const accountEntries = [
      ['global', pda([Buffer.from('global')], this.programId), false, false],
      ['base_mint', baseMint, false, false],
      ['quote_mint', quoteMint, false, false],
      ['base_token_program', baseTokenProgram, false, false],
      ['quote_token_program', quoteTokenProgram, false, false],
      ['associated_token_program', ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
      ['fee_recipient', feeRecipient, false, true],
      ['associated_quote_fee_recipient', associatedQuoteFeeRecipient, false, true],
      ['buyback_fee_recipient', buybackFeeRecipient, false, true],
      ['associated_quote_buyback_fee_recipient', associatedQuoteBuybackFeeRecipient, false, true],
      ['bonding_curve', bondingCurve, false, true],
      ['associated_base_bonding_curve', associatedBaseBondingCurve, false, true],
      ['associated_quote_bonding_curve', associatedQuoteBondingCurve, false, true],
      ['user', userPubkey, true, true],
      ['associated_base_user', associatedBaseUser, false, true],
      ['associated_quote_user', associatedQuoteUser, false, true],
      ['creator_vault', creatorVault, false, true],
      ['associated_creator_vault', associatedCreatorVault, false, true],
      ['sharing_config', pda([Buffer.from('sharing-config'), baseMint.toBuffer()], PUMP_FEE_PROGRAM_ID), false, false],
      ['global_volume_accumulator', pda([Buffer.from('global_volume_accumulator')], this.programId), false, false],
      ['user_volume_accumulator', userVolumeAccumulator, false, true],
      ['associated_user_volume_accumulator', associatedUserVolumeAccumulator, false, true],
      ['fee_config', pda([Buffer.from('fee_config'), this.programId.toBuffer()], PUMP_FEE_PROGRAM_ID), false, false],
      ['fee_program', PUMP_FEE_PROGRAM_ID, false, false],
      ['system_program', SystemProgram.programId, false, false],
      ['event_authority', pda([Buffer.from('__event_authority')], this.programId), false, false],
      ['program', this.programId, false, false],
    ];

    const data = Buffer.concat([
      BUY_V2_DISCRIMINATOR,
      u64Buffer(minTokensOut),
      u64Buffer(maxQuoteLamports),
    ]);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: accountEntries.map(([, pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
      data,
    });
    const setupInstructions = [
      createAssociatedTokenAccountIdempotentInstruction(userPubkey, associatedBaseUser, userPubkey, baseMint, baseTokenProgram),
      createAssociatedTokenAccountIdempotentInstruction(userPubkey, associatedQuoteUser, userPubkey, quoteMint, quoteTokenProgram),
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: associatedQuoteUser,
        lamports: Number(maxQuoteLamports),
      }),
      createSyncNativeInstruction(associatedQuoteUser, quoteTokenProgram),
    ];

    const transaction = new Transaction().add(...setupInstructions, instruction);
    transaction.feePayer = userPubkey;
    transaction.recentBlockhash = blockhash;
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return {
      ok: true,
      instruction,
      transaction,
      setupInstructionCount: setupInstructions.length,
      accountCount: accountEntries.length,
      writableAccounts: accountEntries.filter((entry) => entry[3]).length,
      signerAccounts: accountEntries.filter((entry) => entry[2]).length,
      accountDetails: accountEntries.map(([name, pubkey, isSigner, isWritable]) => ({
        name,
        pubkey: pubkey.toBase58(),
        isSigner,
        isWritable
      })),
      txSizeBytes: serialized.length,
      baseTokenProgram: baseTokenProgram.toBase58(),
      expectedBondingCurveAddress: expectedBondingCurve.toBase58(),
      providedBondingCurveAddress: providedBondingCurve ? providedBondingCurve.toBase58() : null,
      quoteMint: quoteMint.toBase58(),
      quoteTokenProgram: quoteTokenProgram.toBase58(),
      feeRecipient: feeRecipient.toBase58(),
      buybackFeeRecipient: buybackFeeRecipient.toBase58(),
      creatorVault: creatorVault.toBase58(),
      associatedBaseUser: associatedBaseUser.toBase58(),
      associatedQuoteUser: associatedQuoteUser.toBase58(),
      minTokensOutRaw: minTokensOut.toString(),
      expectedTokensOutRaw: expectedRaw.toString(),
      quoteLamports: quoteLamports.toString(),
      maxQuoteLamports: maxQuoteLamports.toString(),
      slippageBps: this.slippageBps,
      accountNames: accountEntries.map(([name]) => name),
      instructionDiscriminator: Array.from(BUY_V2_DISCRIMINATOR),
    };
  }
}

module.exports = {
  PumpBuyV2DryRunBuilder,
  NORMAL_FEE_RECIPIENTS,
  RESERVED_FEE_RECIPIENTS,
  BUYBACK_FEE_RECIPIENTS,
};
