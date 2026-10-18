import { loadEnvConfig } from "@next/env";
import { consumeHandoff, verifyReceipt } from "../src/lib/workflow";
import { closeGraph } from "../src/lib/graph";

loadEnvConfig(process.cwd());
const id = process.argv[2];
if (!id) throw new Error("Usage: npm run sandbox:consume -- <handoff-id>");
consumeHandoff(id)
  .then(async (receipt) =>
    console.log(
      JSON.stringify({ receipt, verification: await verifyReceipt(receipt) }),
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeGraph);
