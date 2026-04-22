class QualityScorer {
  constructor(config) {
    this.config = config;
  }

  score(tokenInfo) {
    const factors = {
      liquidity: this.scoreLiquidity(tokenInfo),
      volume: this.scoreVolume(tokenInfo),
      route: this.scoreRoute(tokenInfo),
      holderRisk: this.scoreHolderRisk(tokenInfo),
      devRisk: this.scoreDevRisk(tokenInfo),
      launchStage: this.scoreLaunchStage(tokenInfo),
      buySellQuality: this.scoreBuySellQuality(tokenInfo)
    };

    const weights = {
      liquidity: 0.25,
      volume: 0.2,
      route: 0.15,
      holderRisk: 0.15,
      devRisk: 0.1,
      launchStage: 0.1,
      buySellQuality: 0.05
    };

    const score = Object.entries(factors).reduce((sum, [key, value]) => {
      return sum + (value * weights[key]);
    }, 0);

    return {
      score: Number(score.toFixed(4)),
      factors
    };
  }

  scoreLiquidity(tokenInfo) {
    const liquidityUsd = Number(tokenInfo.liquidityUsd || tokenInfo.liquidity || 0);
    if (liquidityUsd <= 0) return 0;
    if (liquidityUsd >= this.config.minLiquidityUsd * 10) return 1;
    return Math.min(liquidityUsd / (this.config.minLiquidityUsd * 10), 1);
  }

  scoreVolume(tokenInfo) {
    const volume = Number(tokenInfo.volume || tokenInfo.volume24h || 0);
    if (volume <= 0) return 0;
    if (volume >= this.config.volumeThresholdSol * 10) return 1;
    return Math.min(volume / (this.config.volumeThresholdSol * 10), 1);
  }

  scoreRoute(tokenInfo) {
    if (tokenInfo.quoteable === false) return 0;
    if (tokenInfo.price > 0) return 1;
    return 0.25;
  }

  scoreHolderRisk(tokenInfo) {
    const top10 = tokenInfo.top10HolderPercent;
    if (typeof top10 !== 'number') return 0.5;
    if (top10 >= this.config.maxTop10HolderPercent) return 0;
    return 1 - (top10 / this.config.maxTop10HolderPercent);
  }

  scoreDevRisk(tokenInfo) {
    const devHolding = tokenInfo.devHoldingPercent;
    if (typeof devHolding !== 'number') return 0.5;
    if (devHolding >= this.config.maxDevHoldingPercent) return 0;
    return 1 - (devHolding / this.config.maxDevHoldingPercent);
  }

  scoreLaunchStage(tokenInfo) {
    if (tokenInfo.bondingStage === 'recently_bonded') return 1;
    if (tokenInfo.bondingStage === 'almost_bonded') return 0.8;
    if (tokenInfo.bondingStage === 'new') return 0.5;
    if (tokenInfo.source === 'pumpportal_create') return 0.5;
    if (tokenInfo.source === 'meteora' || tokenInfo.source === 'raydium') return 0.75;
    return 0.5;
  }

  scoreBuySellQuality(tokenInfo) {
    const buys = Number(tokenInfo.buys || 0);
    const sells = Number(tokenInfo.sells || 0);
    if (buys + sells === 0) return 0.5;
    return buys / (buys + sells);
  }
}

module.exports = QualityScorer;
