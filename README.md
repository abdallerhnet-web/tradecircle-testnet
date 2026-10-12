# TradeCircle AI

**Think together. Trade smarter. Prove the outcome.**

A group trade-thesis app for stocks. A circle of people agree on a trade idea together: someone proposes it with entry, stop and target, the room votes once per wallet, and the author records what actually happened. Everything is recorded on-chain.

Live: https://tradecircle-testnet.vercel.app

> **Testnet only.** Runs on Robinhood Chain Testnet (chain ID 46630). No real funds. Not financial advice.

## What it does

1. Connect a wallet and create or join a room (invite by link).
2. Submit a proposal: ticker, long/short, entry, stop, target, thesis, evidence. Pick a stock from the Bitget list to attach its live token price.
3. Read the risk math (percent lost at the stop, percent gained at the target, reward to risk).
4. Tap **Explain this trade to me** for a plain-language AI summary and a list of things to check.
5. Vote For, Against or Abstain. The contract allows one vote per wallet.
6. The author closes voting and records the outcome on-chain.

## What it does not do

- It holds no funds and places no trades. A vote is a signal. It never authorizes or sizes a trade.
- Rooms cannot be deleted because they live on-chain. You can hide a room from your own list on your device.
- The AI cannot see live prices or news, can be wrong, and never recommends buying or selling.
- Bitget prices are token prices. They can differ from the official stock price and are labelled that way.

## How data is labelled

| Label | Meaning |
|---|---|
| On-chain | Read from the registry contract: rooms, members, votes, proposal hashes |
| User-provided | Typed by a member. Not verified |
| Computed | Math done from the typed numbers |
| Bitget live | Public Bitget spot price, read-only |
| AI-generated | Written by an AI model from the proposal text only |

Proposal text is stored in the transaction data. Its keccak256 hash is recorded on-chain and re-checked in the browser.

## Stack

- Vite + vanilla JS single-page app, [viem](https://viem.sh) for wallet and chain access
- Solidity registry contract (`contracts/TradeCircleRegistry.sol`), compiled with solc 0.8.26 at build time (`scripts/compile.mjs`)
- No database: the chain's event log is the database
- Vercel serverless functions in `api/`:
  - `api/bitget.js` proxies Bitget's public market data (no key)
  - `api/review.js` calls an AI provider; keys stay on the server

## Run it yourself

```bash
npm install
npm run build      # compiles the contract, then builds the app
npm run dev        # local dev server (needs the compiled artifact from a build first)
```

1. Install a wallet and get testnet ETH from the Robinhood Chain testnet faucet.
2. Open the app, connect, and use **Deploy a new registry** if you have no registry address yet.
3. Share the invite link. It carries the registry address (`?reg=0x…&from=<block>`).

### Environment variables (Vercel)

All optional. Never put keys in frontend code.

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | AI review via Groq (tried first; the app picks an available model) |
| `ANTHROPIC_API_KEY` | AI review via Claude |
| `GEMINI_API_KEY` | AI review via Google Gemini (free tier; fallback) |
| `GROQ_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL` | Override the model names |
| `VITE_REGISTRY`, `VITE_FROM_BLOCK` | Pre-set the registry address and start block |

With no AI key set, the AI button shows that AI review is not enabled. Rooms, proposals and voting still work.

## Known limits

- MetaMask may warn that the site "might be harmful". This is its blocklist reacting to new `vercel.app` addresses. Report it as a false positive, or use a wallet browser that does not show it. A custom domain is the proper fix.
- Voting has no deadline. The author or room creator closes it manually.
- The desktop layout has not been checked on a real desktop screen.
- The Bitget "stock token" list is matched by token naming (such as an `r` prefix), not an official classification.

## License

No license has been chosen yet.
