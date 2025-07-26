import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import idl from './idl.json' with { type: 'json' };

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const connection = new Connection('https://api.devnet.solana.com');
const feeWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.FEE_WALLET_SECRET)));
const programId = new PublicKey(process.env.ANCHOR_PROGRAM_ID);

const getProgram = () => {
  const provider = new AnchorProvider(connection, {
    publicKey: feeWallet.publicKey,
    signTransaction: async tx => { tx.partialSign(feeWallet); return tx; },
    signAllTransactions: async txs => txs.map(tx => { tx.partialSign(feeWallet); return tx; })
  }, { preflightCommitment: "processed" });

  // Remove programId parameter for Anchor 0.31.0
  return new Program(idl, provider);
};

app.post('/initialize-fee-vault', async (req, res) => {
  try {
    const program = getProgram();

    const [feeVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("fee_vault")],
      programId
    );

    const txSig = await program.methods
      .initializeFeeVault()
      .accounts({
        feeVault: feeVaultPda,
        authority: feeWallet.publicKey,
        systemProgram: SystemProgram.programId
      })
      .signers([feeWallet])
      .rpc();

    res.json({ success: true, txSig, feeVault: feeVaultPda.toString() });
  } catch (err) {
    console.error('Fee vault initialization failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/tip', async (req, res) => {
  const { viewerUserId, creatorUserId, viewerWallet, creatorWallet, amount } = req.body;

  try {
    const program = getProgram();

    const [viewerPda] = await PublicKey.findProgramAddress(
      [Buffer.from("profile"), new PublicKey(viewerWallet).toBuffer(), Buffer.from(viewerUserId)],
      programId
    );

    const [creatorPda] = await PublicKey.findProgramAddress(
      [Buffer.from("profile"), new PublicKey(creatorWallet).toBuffer(), Buffer.from(creatorUserId)],
      programId
    );

    const [feeVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("fee_vault")],
      programId
    );

    const txSig = await program.methods
      .tipCreator(viewerUserId, creatorUserId, new BN(amount))
      .accounts({
        viewerProfile: viewerPda,
        creatorProfile: creatorPda,
        feeVault: feeVaultPda,
        feePayer: feeWallet.publicKey, // Relayer pays transaction fee
        viewer: new PublicKey(viewerWallet),
        creator: new PublicKey(creatorWallet),
        systemProgram: SystemProgram.programId
      })
      .signers([feeWallet]) // Only relayer signs
      .rpc();

    res.json({ success: true, txSig, message: 'Tip sent and fee reimbursed' });
  } catch (err) {
    console.error('Tip failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('Relayer is live 🚀'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Relayer running on port ${PORT}`));