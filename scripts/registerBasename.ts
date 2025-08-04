/**
 * Basename Registration Script
 *
 * This script registers basenames on Base network using the Herd Trails API.
 *
 * Prerequisites:
 * 1. Create a .env file in the root directory with:
 *    WALLET_KEY=0x... (your private key)
 *
 * 2. Install dependencies:
 *    yarn install
 *
 * Usage:
 *    yarn register:basename <basename> <years>     # Register a basename
 *
 * Examples:
 *    yarn register:basename myname 1               # Register "myname" for 1 year
 *    yarn register:basename mybasename 2           # Register "mybasename" for 2 years
 *
 * The script will:
 * - Ask for confirmation before proceeding
 * - Submit the registration transaction
 * - Update the execution with the transaction hash
 *
 * Reference documentation: https://trails-api.herd.eco/v1/trails/01977985-e215-7b04-8141-009a1a68f631/versions/01977985-e22c-76e0-9e1f-ead0222ff050/guidebook.txt?promptObject=script
 * Trail overlook (sandbox): https://herd.eco/trails/01977985-e215-7b04-8141-009a1a68f631/overlook
 */

import { createInterface } from "readline";
import { config } from "dotenv";
import { createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

config();

const TRAIL_ID = "01977985-e215-7b04-8141-009a1a68f631";
const VERSION_ID = "01977985-e22c-76e0-9e1f-ead0222ff050";
const BASE_API_URL = "https://trails-api.herd.eco/v1";

interface TrailExecution {
  id: string;
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    stepNumber: number;
    nodeId: string | null;
    txHash: string;
    txBlockTimestamp: number | null;
    txBlockNumber: number | null;
    createdAt: string;
  }>;
}

interface PriceInfo {
  base: string;
  premium: string;
}

interface NameExpiryInfo {
  expiry: string;
}

interface ExecutionQueryResult {
  walletExecutions: Array<{
    walletAddress: string;
    executions: TrailExecution[];
  }>;
}

interface EvaluationResult {
  contractAddress: string;
  callData: string;
  payableAmount: string;
}

class BasenameRegistrar {
  private walletClient: any;
  private account: any;

  constructor(privateKey: string) {
    this.account = privateKeyToAccount(privateKey as `0x${string}`);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(),
    });
  }

  private async promptConfirmation(message: string): Promise<boolean> {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${message} (y/N): `, (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
      });
    });
  }

  async getExecutionsForWallet(): Promise<TrailExecution[]> {
    const response = await fetch(
      `${BASE_API_URL}/trails/${TRAIL_ID}/versions/${VERSION_ID}/executions/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddresses: [this.account.address.toLowerCase()],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get executions: ${response.statusText}`);
    }

    const result = (await response.json()) as ExecutionQueryResult;
    const walletData = result.walletExecutions.find(
      (w) =>
        w.walletAddress.toLowerCase() === this.account.address.toLowerCase(),
    );

    return walletData?.executions || [];
  }

  getNextStepNumberForExecution(execution: TrailExecution): number {
    // Filter out step 0 (the initial step with nil hash) and find the highest step number
    const completedSteps = execution.steps.filter(
      (step) =>
        step.stepNumber > 0 &&
        step.txHash !==
          "0x0000000000000000000000000000000000000000000000000000000000000000",
    );

    if (completedSteps.length === 0) {
      return 1; // If no real steps completed, next step is 1
    }

    const maxStepNumber = Math.max(
      ...completedSteps.map((step) => step.stepNumber),
    );
    return maxStepNumber + 1;
  }

  async getPricing(basename: string, years: number): Promise<PriceInfo> {
    const response = await fetch(
      `${BASE_API_URL}/trails/${TRAIL_ID}/versions/${VERSION_ID}/nodes/0197799c-6038-7037-a62a-8caae62e8a2e/read`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: this.account.address,
          userInputs: {
            "01977986-60bf-7791-ac80-19f99c070fac": {
              "inputs.request.name": {
                value: basename,
              },
            },
            "01977e4e-2170-73ec-8829-bee089568bfc": {
              years: {
                value: years.toString(),
              },
            },
          },
          execution: {
            type: "latest",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get pricing: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      outputs: {
        arg_0: {
          value: [{ value: string }, { value: string }];
        };
      };
    };

    return {
      base: result.outputs.arg_0.value[0].value,
      premium: result.outputs.arg_0.value[1].value,
    };
  }

  async getNameExpiry(basename: string): Promise<NameExpiryInfo> {
    const response = await fetch(
      `${BASE_API_URL}/trails/${TRAIL_ID}/versions/${VERSION_ID}/nodes/01977e53-1e8a-7acb-83de-9d1abfa3f88a/read`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: this.account.address,
          userInputs: {
            "01977986-60bf-7791-ac80-19f99c070fac": {
              "inputs.request.name": {
                value: basename,
              },
            },
          },
          execution: {
            type: "latest",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get name expiry: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      outputs: {
        expiry: {
          value: string;
        };
      };
    };

    return {
      expiry: result.outputs.expiry.value,
    };
  }

  async getTransactionCalldata(
    basename: string,
    years: number,
    execution: "latest" | "new" | { type: "manual"; executionId: string },
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasEstimate: string;
  }> {
    const response = await fetch(
      `${BASE_API_URL}/trails/${TRAIL_ID}/versions/${VERSION_ID}/steps/1/evaluations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: this.account.address,
          userInputs: {
            "01977e4e-2170-73ec-8829-bee089568bfc": {
              years: {
                value: years.toString(),
              },
            },
            "01977986-60bf-7791-ac80-19f99c070fac": {
              "inputs.request.name": {
                value: basename,
              },
              "inputs.request.data": {
                value: "",
              },
            },
          },
          execution:
            typeof execution === "string" ? { type: execution } : execution,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get transaction calldata: ${response.statusText}`,
      );
    }

    const result = (await response.json()) as EvaluationResult;
    return {
      to: result.contractAddress,
      data: result.callData,
      value: result.payableAmount || "0",
      gasEstimate: "21000", // Default estimate
    };
  }

  async submitTransaction(
    to: string,
    data: string,
    value: string,
  ): Promise<string> {
    try {
      const txHash = await this.walletClient.sendTransaction({
        to: to as `0x${string}`,
        data: data as `0x${string}`,
        value: BigInt(value),
      });

      console.log(`Transaction submitted: https://herd.eco/base/tx/${txHash}`);
      return txHash;
    } catch (error) {
      console.error("Transaction failed:", error);
      throw error;
    }
  }

  async updateExecutionWithTxHash(
    execution: "latest" | "new" | { type: "manual"; executionId: string },
    stepNumber: number,
    txHash: string,
  ): Promise<void> {
    const response = await fetch(
      `${BASE_API_URL}/trails/${TRAIL_ID}/versions/${VERSION_ID}/executions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nodeId: "01977986-60bf-7791-ac80-19f99c070fac", // Primary node ID for step 1
          transactionHash: txHash,
          walletAddress: this.account.address,
          execution:
            typeof execution === "string" ? { type: execution } : execution,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to update execution: ${response.statusText}`);
    }
  }

  async registerBasename(basename: string, years: number): Promise<void> {
    console.log(`\n🎯 Starting basename registration for: ${basename}`);
    console.log(`📅 Duration: ${years} year(s)`);
    console.log(
      `👛 Wallet: https://herd.eco/base/wallet/${this.account.address}\n`,
    );

    try {
      // Check current pricing and availability
      console.log("📊 Checking pricing and availability...");
      const [pricing, expiry] = await Promise.all([
        this.getPricing(basename, years),
        this.getNameExpiry(basename),
      ]);

      const totalCost = BigInt(pricing.base) + BigInt(pricing.premium);
      console.log(`💰 Base price: ${formatEther(BigInt(pricing.base))} ETH`);
      console.log(`💰 Premium: ${formatEther(BigInt(pricing.premium))} ETH`);
      console.log(`💰 Total cost: ${formatEther(totalCost)} ETH`);

      if (BigInt(expiry.expiry) > 0) {
        const expiryDate = new Date(Number(expiry.expiry) * 1000);
        console.log(`⚠️  Name expires: ${expiryDate.toLocaleDateString()}`);
        console.log(
          `\n📝 This name is already registered and will expire on ${expiryDate.toLocaleDateString()}.`,
        );
        console.log(
          `💡 You can register it after it expires, or choose a different name.`,
        );
        return;
      } else {
        console.log("✅ Name is available for registration");
      }

      // Ask for confirmation
      const confirmed = await this.promptConfirmation(
        `\n🔐 Do you want to register "${basename}" for ${years} year(s) at ~${formatEther(totalCost)} ETH?`,
      );

      if (!confirmed) {
        console.log("❌ Registration cancelled by user.");
        return;
      }

      // Get or determine execution
      const executions = await this.getExecutionsForWallet();
      let executionId: string | undefined;
      let executionMode:
        | "latest"
        | "new"
        | { type: "manual"; executionId: string };

      if (executions.length > 0) {
        // Use the latest execution
        const latestExecution = executions.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        )[0];
        executionId = latestExecution.id;
        executionMode = { type: "manual", executionId };

        // Check if we can proceed with step 1
        const nextStep = this.getNextStepNumberForExecution(latestExecution);
        if (nextStep !== 1) {
          throw new Error(
            `Cannot proceed with registration. Next step is ${nextStep}, expected 1`,
          );
        }
      } else {
        // No existing executions, use "latest" mode which will create a new one
        executionMode = "latest";
      }

      // Get transaction calldata
      console.log("📝 Getting transaction calldata...");
      const calldata = await this.getTransactionCalldata(
        basename,
        years,
        executionMode,
      );

      console.log(
        `💸 Transaction value: ${formatEther(BigInt(calldata.value))} ETH`,
      );
      console.log(`⛽ Gas estimate: ${calldata.gasEstimate}`);

      // Submit transaction
      console.log("\n🔄 Submitting registration transaction...");
      const txHash = await this.submitTransaction(
        calldata.to,
        calldata.data,
        calldata.value,
      );

      // Update execution with transaction hash
      console.log("📋 Updating execution...");
      await this.updateExecutionWithTxHash(executionMode, 1, txHash);

      console.log("\n✅ Basename registration initiated successfully!");
      console.log(`🔗 Transaction: https://herd.eco/base/tx/${txHash}`);
      if (executionId) {
        console.log(`📋 Execution ID: ${executionId}`);
      }
      console.log(
        "\n⏳ Wait for transaction confirmation to complete registration.",
      );
    } catch (error) {
      console.error("\n❌ Registration failed:", error);
      throw error;
    }
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage:");
    console.log("  yarn register:basename <basename> <years>");
    console.log("\nExamples:");
    console.log("  yarn register:basename myname 1");
    console.log("  yarn register:basename mybasename 2");
    process.exit(1);
  }

  const basename = args[0];
  const years = parseInt(args[1]);

  if (isNaN(years) || years < 1) {
    console.error("Years must be a positive integer");
    process.exit(1);
  }

  const walletKey = process.env.WALLET_KEY;
  if (!walletKey) {
    console.error("WALLET_KEY not found in environment variables");
    process.exit(1);
  }

  try {
    const registrar = new BasenameRegistrar(walletKey);
    await registrar.registerBasename(basename, years);
  } catch (error) {
    console.error("Registration failed:", error);
    process.exit(1);
  }
}

// Handle CLI commands
if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log("Basename Registration Script");
  console.log("Usage:");
  console.log("  yarn register:basename <basename> <years>");
  console.log("\nArguments:");
  console.log("  <basename>               The basename you want to register");
  console.log("  <years>                  Number of years to register for");
  console.log("  --help, -h               Show this help message");
  console.log("\nExamples:");
  console.log("  yarn register:basename myname 1");
  console.log("  yarn register:basename mybasename 2");
  process.exit(0);
}

// Only run main if this file is executed directly
if (process.argv[1] && process.argv[1].endsWith("registerBasename.ts")) {
  main().catch(console.error);
}

export { BasenameRegistrar };
