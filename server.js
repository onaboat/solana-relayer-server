import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { BN } from 'bn.js'; // Use bn.js instead of Anchor's BN
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Handle ES modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Add comprehensive error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Validate environment variables
if (!process.env.FEE_WALLET_SECRET) {
  console.error('Missing FEE_WALLET_SECRET environment variable');
  process.exit(1);
}

if (!process.env.ANCHOR_PROGRAM_ID) {
  console.error('Missing ANCHOR_PROGRAM_ID environment variable');  
  process.exit(1);
}

// Load IDL safely
let idl;
try {
  const idlPath = join(__dirname, 'idl.json');
  const idlData = readFileSync(idlPath, 'utf8');
  idl = JSON.parse(idlData);
  console.log('IDL loaded successfully');
} catch (error) {
  console.error('Failed to load IDL:', error.message);
  process.exit(1);
}

// Initialize connection and wallet safely
let connection, feeWallet, programId;
try {
  connection = new Connection(
    process.env.RPC_URL || 'https://api.devnet.solana.com',
    'confirmed'
  );
  
  feeWallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(process.env.FEE_WALLET_SECRET))
  );
  
  programId = new PublicKey(process.env.ANCHOR_PROGRAM_ID);
  
  console.log('Solana setup complete');
  console.log('Fee wallet:', feeWallet.publicKey.toString());
  console.log('Program ID:', programId.toString());
} catch (error) {
  console.error('Failed to initialize Solana components:', error.message);
  process.exit(1);
}

const getProgram = () => {
  try {
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: feeWallet.publicKey,
        signTransaction: async (tx) => { 
          tx.partialSign(feeWallet); 
          return tx; 
        },
        signAllTransactions: async (txs) => {
          return txs.map(tx => { 
            tx.partialSign(feeWallet); 
            return tx; 
          });
        }
      },
      { 
        preflightCommitment: "confirmed",
        commitment: "confirmed"
      }
    );

    // THIS IS THE KEY CHANGE - Remove programId parameter
    return new Program(idl, provider);
  } catch (error) {
    console.error('Failed to create program:', error);
    throw error;
  }
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy',
    message: 'Relayer is live 🚀',
    wallet: feeWallet.publicKey.toString(),
    programId: programId.toString(),
    timestamp: new Date().toISOString()
  });
});

// Add connection test endpoint
app.get('/health', async (req, res) => {
  try {
    const balance = await connection.getBalance(feeWallet.publicKey);
    res.json({
      status: 'healthy',
      walletBalance: balance / 1e9 + ' SOL',
      connection: 'ok'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

app.post('/initialize-fee-vault', async (req, res) => {
  try {
    console.log('Initializing fee vault...');
    const program = getProgram();

    const [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      programId
    );

    console.log('Fee vault PDA:', feeVaultPda.toString());

    const txSig = await program.methods
      .initializeFeeVault()
      .accounts({
        feeVault: feeVaultPda,
        authority: feeWallet.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([feeWallet])
      .rpc();

    console.log('Fee vault initialized:', txSig);
    res.json({ 
      success: true, 
      txSig, 
      feeVault: feeVaultPda.toString() 
    });
  } catch (err) {
    console.error('Fee vault initialization failed:', err);
    res.status(500).json({ 
      error: err.message,
      details: err.logs || []
    });
  }
});

app.post('/tip', async (req, res) => {
  const { viewerUserId, creatorUserId, viewerWallet, creatorWallet, amount } = req.body;

  console.log('Tip request received:', { 
    viewerUserId, 
    creatorUserId, 
    viewerWallet, 
    creatorWallet, 
    amount 
  });
  
  // Validate all required fields
  if (!viewerUserId || !creatorUserId || !viewerWallet || !creatorWallet || amount === undefined) {
    return res.status(400).json({ 
      error: 'Missing required parameters',
      required: ['viewerUserId', 'creatorUserId', 'viewerWallet', 'creatorWallet', 'amount']
    });
  }

  // Validate amount
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ 
      error: 'Invalid amount - must be a positive number' 
    });
  }

  try {
    const program = getProgram();

    // Validate wallet addresses
    let viewerPubkey, creatorPubkey;
    try {
      viewerPubkey = new PublicKey(viewerWallet);
      creatorPubkey = new PublicKey(creatorWallet);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid wallet address format' 
      });
    }

    const [viewerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), viewerPubkey.toBuffer(), Buffer.from(viewerUserId)],
      programId
    );

    const [creatorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), creatorPubkey.toBuffer(), Buffer.from(creatorUserId)],
      programId
    );

    const [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      programId
    );

    console.log('PDAs calculated:', {
      viewerPda: viewerPda.toString(),
      creatorPda: creatorPda.toString(),
      feeVaultPda: feeVaultPda.toString()
    });

    const txSig = await program.methods
      .tipCreator(viewerUserId, creatorUserId, new BN(amount))
      .accounts({
        viewerProfile: viewerPda,
        creatorProfile: creatorPda,
        feeVault: feeVaultPda,
        feePayer: feeWallet.publicKey,
        viewer: viewerPubkey,
        creator: creatorPubkey,
        systemProgram: SystemProgram.programId
      })
      .signers([feeWallet])
      .rpc();

    console.log('Tip successful:', txSig);
    res.json({ 
      success: true, 
      txSig, 
      message: 'Tip sent and fee reimbursed' 
    });
  } catch (err) {
    console.error('Tip failed:', err);
    res.status(500).json({ 
      error: err.message,
      details: err.logs || [],
      code: err.code || 'UNKNOWN_ERROR'
    });
  }
});

app.get('/debug-idl', (req, res) => {
  res.json({
    programId: programId.toString(),
    instructions: idl.instructions.map(i => i.name),
    accounts: idl.accounts.map(a => a.name),
    hasInitializeFeeVault: idl.instructions.some(i => i.name === 'initialize_fee_vault')
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Relayer server started successfully`);
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`💰 Fee wallet: ${feeWallet.publicKey.toString()}`);
  console.log(`🏗️  Program ID: ${programId.toString()}`);
});