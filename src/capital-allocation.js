class CapitalAllocation {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  getProfitAllocationByEquity(totalEquitySol) {
    const tier = this.findTier(
      this.config.profitAllocationTiers,
      'maxEquitySol',
      totalEquitySol
    );

    return {
      totalEquitySol,
      hotShare: tier.hotShare,
      coldShare: tier.coldShare
    };
  }

  getRiskSizeByHotEquity(hotEquitySol) {
    const tier = this.findTier(
      this.config.riskSizeTiers,
      'maxHotEquitySol',
      hotEquitySol
    );

    return {
      hotEquitySol,
      riskPercent: tier.riskPercent,
      tradeAmountSol: hotEquitySol * tier.riskPercent
    };
  }

  allocateRealizedProfit(realizedProfitSol, hotEquitySol, coldEquitySol) {
    if (realizedProfitSol <= 0) {
      return {
        realizedProfitSol,
        hotAllocationSol: 0,
        coldAllocationSol: 0,
        hotWalletBalanceSol: hotEquitySol,
        coldWalletBalanceSol: coldEquitySol,
        tier: this.getProfitAllocationByEquity(hotEquitySol + coldEquitySol)
      };
    }

    const tier = this.getProfitAllocationByEquity(hotEquitySol + coldEquitySol);
    const hotAllocationSol = realizedProfitSol * tier.hotShare;
    const coldAllocationSol = realizedProfitSol * tier.coldShare;

    return {
      realizedProfitSol,
      hotAllocationSol,
      coldAllocationSol,
      hotWalletBalanceSol: hotEquitySol + hotAllocationSol,
      coldWalletBalanceSol: coldEquitySol + coldAllocationSol,
      tier
    };
  }

  computeTradeAmount(hotEquitySol, fallbackAmountSol) {
    const riskSizing = this.getRiskSizeByHotEquity(hotEquitySol);
    return Math.min(riskSizing.tradeAmountSol, hotEquitySol, fallbackAmountSol || riskSizing.tradeAmountSol);
  }

  findTier(tiers, key, equity) {
    const sortedTiers = [...tiers].sort((a, b) => {
      const aMax = a[key] == null ? Number.POSITIVE_INFINITY : a[key];
      const bMax = b[key] == null ? Number.POSITIVE_INFINITY : b[key];
      return aMax - bMax;
    });

    return sortedTiers.find(tier => tier[key] == null || equity <= tier[key]) || sortedTiers[sortedTiers.length - 1];
  }
}

module.exports = CapitalAllocation;
