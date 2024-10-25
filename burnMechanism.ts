import {   clusterApiUrl,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction, VersionedTransaction, Connection, sendAndConfirmTransaction, sendAndConfirmRawTransaction, TransactionInstruction, LAMPORTS_PER_SOL, SendOptions  } from '@solana/web3.js';
import bs58 from 'bs58';

import * as splToken from '@solana/spl-token';

//connect your rpc route to run
const RPC_ENDPOINT = "rpc-route";
const connection = new Connection(
    RPC_ENDPOINT,
    'confirmed',
);

//attach dev wallet by using its secret key/private key
const devWallet = Keypair.fromSecretKey(bs58.decode('secret-key-of-dev-wallet'));


//change this to your tokens address
let mintAddress = "mint-Address";

let token_holders:any[]=[];

async function getAllTokenAccounts(mintAddress:any) {
  try {
    // `Token Program ID` for Solana SPL tokens
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const mint = new PublicKey(mintAddress);

    // Retrieve all token accounts for the specified mint address
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        {
          dataSize: 165, // Token account size in bytes
        },
        {
          memcmp: {
            offset: 0, // Mint address is at the beginning of the account data
            bytes: mint.toBase58(),
          },
        },
      ],
    });

  //  console.log(`Found ${tokenAccounts.length} token accounts for mint address: ${mint.toBase58()}`);
    return tokenAccounts;
  } catch (err) {
    console.error('Error fetching token accounts:', err);
  }
}

let firstIteration = true;


//gets all token holders info of token
async function getTokenBalances(mintAddress:any) {
  const tokenAccounts = await getAllTokenAccounts(mintAddress);

  if (!tokenAccounts) return;

  if(!firstIteration){
    token_holders = [];
  }
  const balances = [];

  // Iterate through each token account and extract balances
  for (const account of tokenAccounts) {
    const accountData = account.account.data;
    const ownerAddress = new PublicKey(accountData.slice(32, 64)).toBase58(); // Owner's public key

    const DECIMALS = 6;
    const SCALING_FACTOR = BigInt(10 ** DECIMALS); // Equivalent to 1,000,000 for 6 decimals
    const rawBalance = accountData.readBigUInt64LE(64);

    // Convert the balance from its raw smallest unit to the integer token amount
    const tokenAmountInteger = Number(rawBalance / SCALING_FACTOR); // Convert to number for easier handling


    if(ownerAddress !== '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'){

      if (tokenAmountInteger > BigInt(100)) {

        const existingHolder = token_holders.find( (holder:any) => holder.holder === ownerAddress);

        if (!existingHolder) {
          token_holders.push({ holder: ownerAddress, amount: tokenAmountInteger });
        } else {
          existingHolder.amount = tokenAmountInteger;
        }
      }
    }


  }
  firstIteration = false;

}


function updateHolderData() {

  token_holders = token_holders.filter(holder => holder.amount >= 200000).map(holder => ({
    holder: holder.holder,
    amount: holder.amount,
    percentage: (holder.amount / 1_000_000_000) * 100
  })).sort((a, b) => b.percentage - a.percentage);

  const totalHolderCount = token_holders.length; //gets total holders to include in burn operation


  const burn_percentage = totalHolderCount * 0.001; //calculation for total burn amount. total holders who own more than 200000 tokens multiplied by 0.001
  return [burn_percentage];
}


async function burnTokens(burnPercentage:any) {
  try {

    // Get the mint information (including decimals)
    const mint = new PublicKey(mintAddress);
    const mintInfo = await splToken.getMint(connection, mint);

    const tokenAccount = await splToken.getOrCreateAssociatedTokenAccount(
      connection,
      devWallet,              // Dev wallet's keypair
      mint,            // SPL token's mint address
      devWallet.publicKey     // Dev wallet's public key
    );

    // Get current token balance of the dev wallet's associated token account
    const tokenAccountInfo = await splToken.getAccount(connection, tokenAccount.address);
    const currentBalance = tokenAccountInfo.amount; // Token balance in raw format (without decimals)
    const burnPercentageBigInt = BigInt(Math.floor(burnPercentage * 100)); // Represent percentage as integer for precision

    // Use 10000 to represent 100% (since we scaled up by 100)
    const amountToBurn = (currentBalance * burnPercentageBigInt) / BigInt(10000);
    // Calculate the amount to burn based on the burnPercentage
  //  console.log("amount to burn for this account", amountToBurn);

    if (amountToBurn) {
      // Create the burn transaction
      const signature = await splToken.burnChecked(
        connection,               // Solana connection
        devWallet,                // The dev wallet (payer)
        tokenAccount.address,     // Associated token account to burn from
        mint,              // Token mint address
        devWallet.publicKey,      // Owner of the token account (dev wallet)
        amountToBurn,             // Amount to burn (bigint)
        mintInfo.decimals,        // Mint decimals to adjust the amount precision
        [],                       // Multi-signers (empty for single signature)
        { skipPreflight: false }  // Confirm options
      );

      console.log(`Burned ${amountToBurn} tokens. Transaction Signature:`, signature);

      await postBurnResultOnTwitter(amountToBurn, signature);
    } else {
      console.log('No tokens to burn. Burn percentage too low.');
    }
  } catch (error) {
    console.error('Error burning tokens:', error);
  }
}


// Function to run on interval that gets the burn percentage and calls burnTokens
function processBurn() {
  const [burn_percentage] = updateHolderData(); // Get the burn percentage from the array
  burnTokens(burn_percentage); // Pass the burn percentage to burnTokens function
}

setInterval(processBurn, 600000); // run the burn process every 10 minutes

setInterval(() => getTokenBalances(mintAddress), 12000); //grab token holder information every few minutes
