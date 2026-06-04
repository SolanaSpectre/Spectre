const {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');

class WalletManager {
  constructor(privateKey) {
    try {
      // Decode base58 private key
      const secretKey = bs58.decode(privateKey);
      this.keypair = Keypair.fromSecretKey(secretKey);
      this.address = this.keypair.publicKey.toBase58();
    } catch (error) {
      throw new Error(`Invalid private key format: ${error.message}`);
    }
  }

  getPublicKey() {
    return this.keypair.publicKey;
  }

  getPrivateKey() {
    return this.keypair.secretKey;
  }

  getAddress() {
    return this.address;
  }

  getKeypair() {
    return this.keypair;
  }

  static generateNewWallet() {
    const keypair = Keypair.generate();
    return {
      keypair,
      address: keypair.publicKey.toBase58(),
      privateKey: bs58.encode(keypair.secretKey)
    };
  }

  static validateAddress(address) {
    try {
      // Basic validation - check if it's a valid base58 string
      bs58.decode(address);
      return address.length >= 32 && address.length <= 44; // Solana addresses are typically 44 chars
    } catch {
      return false;
    }
  }

  static toPublicKey(address) {
    return new PublicKey(address);
  }

  static async getSolBalance(connection, address) {
    const publicKey = address instanceof PublicKey ? address : new PublicKey(address);
    const lamports = await connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  static async getOwnedTokenAccounts(connection, ownerAddress) {
    const owner = ownerAddress instanceof PublicKey ? ownerAddress : new PublicKey(ownerAddress);
    const programIds = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
    const accounts = [];

    for (const programId of programIds) {
      const response = await connection.getParsedTokenAccountsByOwner(owner, { programId });
      for (const { pubkey, account } of response.value || []) {
        const parsed = account?.data?.parsed?.info;
        const mint = parsed?.mint || null;
        const tokenAmount = parsed?.tokenAmount || {};
        const amountRaw = tokenAmount.amount || '0';
        const uiAmount = Number(tokenAmount.uiAmount || 0);

        accounts.push({
          address: pubkey.toBase58(),
          mint,
          amountRaw,
          uiAmount,
          decimals: Number(tokenAmount.decimals || 0),
          programId: programId.toBase58()
        });
      }
    }

    return accounts;
  }

  async transferSol(connection, destinationAddress, amountSol) {
    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
    if (lamports <= 0) {
      throw new Error(`Transfer amount must be positive, got ${amountSol}`);
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.getPublicKey(),
        toPubkey: destinationAddress instanceof PublicKey ? destinationAddress : new PublicKey(destinationAddress),
        lamports
      })
    );

    const latestBlockhash = await connection.getLatestBlockhash();
    transaction.feePayer = this.getPublicKey();
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.sign(this.keypair);

    WalletManager.assertLiveBroadcastAllowed('transferSol');
    const signature = await connection.sendRawTransaction(transaction.serialize());
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    });

    return signature;
  }

  static assertLiveBroadcastAllowed(operation = 'sendRawTransaction') {
    const executionMode = String(process.env.EXECUTION_MODE || '').toUpperCase();
    const argv = process.argv.slice(2);
    const confirmLive = argv.includes('--confirmLive=true')
      || argv.some((arg, index) => arg === '--confirmLive' && argv[index + 1] === 'true');

    if (executionMode !== 'LIVE' || !confirmLive) {
      throw new Error(
        `CRITICAL SAFETY VETO: ${operation} attempted without EXECUTION_MODE=LIVE and --confirmLive true`
      );
    }
  }
}

module.exports = WalletManager;
