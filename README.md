# 🛰️ Xavra Relayer

A lightweight Express-based relayer for **Xavra**, a Solana-powered social app enabling micro-tipping between users. The relayer handles PDA account setup, creator tipping, and gas-fee delegation using a fee-paying wallet.

---

## Features

- Anchor program interaction with Solana
- PDA generation for user profiles
- Micro-tipping with viewer → creator SOL flow
- FeeVault for gas reimbursement
- Full Express.js REST API
- Uses Solana Mobile-compatible infrastructure

---

## Tech Stack

- Node.js + Express
- `@solana/web3.js`
- `@coral-xyz/anchor`
- `bn.js`
- dotenv
- Helius RPC (or custom)

---

## 🔧 Environment Setup

Create a `.env` file:

```bash
FEE_WALLET_SECRET=[JSON Array of your Keypair]
ANCHOR_PROGRAM_ID=[Your deployed Anchor Program ID]
RPC_URL=https://api.devnet.solana.com
PORT=8080
```

Install dependencies:

```bash
npm install
```

Run the server:

```bash
node index.js
```

---

##  API Endpoints

### Health

```http
GET /
GET /health
```

Returns server status and fee wallet balance.

---

### Initialize Fee Vault

```http
POST /initialize-fee-vault
```

Creates a `fee_vault` PDA and initializes it on-chain.

---

### Initialize Profile

```http
POST /initialize-profile
Content-Type: application/json
{
  "userId": "abc123",
  "userWallet": "WalletAddress"
}
```

Creates a profile PDA for the user using `[“profile”, userPubkey, userId]`.

---

### Tip a Creator

```http
POST /tip
Content-Type: application/json
{
  "viewerUserId": "viewer1",
  "creatorUserId": "creator1",
  "viewerWallet": "ViewerWalletAddress",
  "creatorWallet": "CreatorWalletAddress",
  "amount": 10000  // in lamports
}
```

Transfers SOL to the creator on-chain, with gas paid by the relayer and reimbursed.

---

### Fund PDA

```http
POST /fund-pda
Content-Type: application/json
{
  "pdaAddress": "TargetPDA"
}
```

Sends 0.1 SOL from the fee wallet to a target PDA.

---

### Debug IDL

```http
GET /debug-idl
```

Returns loaded IDL metadata and supported instructions.

---

##  Usage Diagram (ASCII)

```
          +------------------+         POST /initialize-profile         +------------------+
          |     Mobile App   |  ------------------------------------>  |     Relayer API   |
          +------------------+                                         +------------------+
                    |                                                           |
                    |                                                           v
                    |                                          Derive PDA for user profile
                    |                                                           |
                    |                                                           v
                    |                                     Call Anchor method: initializeProfile
                    |                                                           |
                    |                                                           v
                    |                                         Tx sent to Solana using FeeWallet
                    |                                                           |
                    |                                                           v
                    |                                         Profile initialized on-chain
                    |                                                           |
                    |<---------------- Response: Tx Signature ------------------+

--------------------------------------------------- TIP FLOW ---------------------------------------------------

          +------------------+         POST /tip                         +------------------+
          |     Mobile App   |  ------------------------------------>  |     Relayer API   |
          +------------------+                                         +------------------+
                    |                                                           |
                    |                                                           v
                    |                                   Derive viewer/creator PDAs, feeVault PDA
                    |                                                           |
                    |                                                           v
                    |                                      Call Anchor method: tipCreator
                    |                                                           |
                    |                                                           v
                    |                           FeeWallet sends SOL, reimbursed via feeVault
                    |                                                           |
                    |                                                           v
                    |                           On-chain tip sent + fee logic recorded
                    |                                                           |
                    |<---------------- Response: Tx Signature ------------------+
```

---

##  Error Handling

- Graceful handling of uncaught exceptions
- Validations for all inputs (wallets, amounts, IDs)
- Logs and structured error messages on all endpoints

---



