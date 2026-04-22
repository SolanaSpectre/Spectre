class SafetyGate {
  constructor(config) {
    this.config = config;
  }

  async validateToken(tokenInfo) {
    if (!tokenInfo || !tokenInfo.mintAddress) {
      return { passed: false, reason: 'INVALID_TOKEN_INFO', riskScore: 0 };
    }

    if (tokenInfo.quoteable === false) {
      return { passed: false, reason: 'TOKEN_NOT_QUOTEABLE', riskScore: 0 };
    }

    if (tokenInfo.program === 'spl-token-2022' && this.config.rejectToken2022) {
      return { passed: false, reason: 'UNSUPPORTED_TOKEN_2022', riskScore: 0 };
    }

    if (tokenInfo.token2022Extensions?.transferHook || tokenInfo.token2022Extensions?.transferFee) {
      return { passed: false, reason: 'UNSUPPORTED_TOKEN_EXTENSION', riskScore: 0 };
    }

    if (tokenInfo.mintAuthority !== undefined && tokenInfo.mintAuthority !== null) {
      return { passed: false, reason: 'MINT_AUTHORITY_ACTIVE', riskScore: 0 };
    }

    if (tokenInfo.freezeAuthority !== undefined && tokenInfo.freezeAuthority !== null) {
      return { passed: false, reason: 'FREEZE_AUTHORITY_ACTIVE', riskScore: 0 };
    }

    if ((tokenInfo.liquidityUsd || 0) < this.config.minLiquidityUsd) {
      return { passed: false, reason: 'INSUFFICIENT_LIQUIDITY', riskScore: 0 };
    }

    if (
      typeof tokenInfo.top10HolderPercent === 'number' &&
      tokenInfo.top10HolderPercent > this.config.maxTop10HolderPercent
    ) {
      return { passed: false, reason: 'TOP10_HOLDER_CONCENTRATION_HIGH', riskScore: 0 };
    }

    if (
      typeof tokenInfo.devHoldingPercent === 'number' &&
      tokenInfo.devHoldingPercent > this.config.maxDevHoldingPercent
    ) {
      return { passed: false, reason: 'DEV_HOLDING_HIGH', riskScore: 0 };
    }

    if ((tokenInfo.price || 0) <= 0) {
      return { passed: false, reason: 'NO_PRICE_AVAILABLE', riskScore: 0 };
    }

    return {
      passed: true,
      reason: 'OK',
      riskScore: tokenInfo.riskScore ?? 0.5
    };
  }
}

module.exports = SafetyGate;
