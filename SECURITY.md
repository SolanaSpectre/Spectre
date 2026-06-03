# Security Policy

Spectre is published as a research and diagnostics project. The default posture is paper-only; live execution should be treated as experimental and unsafe unless separately reviewed, configured, and monitored by the operator.

## Supported Versions

Security reports should target the current `main` branch.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if available, or open an issue with minimal reproduction details if the report does not expose secrets or exploitable live systems.

Useful reports include:

- leaked credentials, private keys, wallet material, or session tokens
- code paths that could bypass explicit live-trading confirmation gates
- unsafe defaults that could unexpectedly broadcast transactions
- dependency or supply-chain issues with practical exploit paths
- logging behavior that may reveal secrets

Please do not include real private keys, funded wallet material, Telegram sessions, API keys, or other credentials in a public issue.

## Non-Security Issues

Trading losses, bad strategy performance, missed entries, paper/live divergence, market manipulation by third parties, and memecoin volatility are not security vulnerabilities by themselves. Open normal GitHub issues for diagnostics, reporting bugs, or strategy research.

## Operator Safety

- Use burner wallets for testing.
- Keep `.env` files and generated runtime data private.
- Rotate any credential that may have been copied into logs, reports, screenshots, or local experiments.
- Review all live-execution settings before running anything outside PAPER mode.
