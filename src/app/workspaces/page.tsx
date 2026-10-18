import { WorkspaceConsole } from "@/components/workspace-console";

export default function Workspaces() {
  if (process.env.ENABLE_EXPERIMENTAL_WORKSPACES !== "true")
    return (
      <div style={{ maxWidth: 720, margin: "80px auto", padding: 30 }}>
        <h1>Experimental workspace preview</h1>
        <p>
          The larger dataset, account, and GraphRAG upgrade is not part of the
          verified hackathon submission. Its end-to-end verification is
          incomplete.
        </p>
        <p>
          <a href="/workspace">Open the verified AFTERSHOCK demo →</a>
        </p>
      </div>
    );
  return <WorkspaceConsole />;
}
