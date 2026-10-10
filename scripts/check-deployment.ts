export async function checkDeployment(): Promise<void> {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error("Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID so the build can verify private access.");
  }
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not verify Vercel Deployment Protection. Deployment stopped.");
  }
  if (!response.ok) {
    throw new Error(`Vercel protection check failed (HTTP ${response.status}). Check the API token and project scope.`);
  }
  const project = await response.json() as { id?: string; ssoProtection?: { deploymentType?: string } | null };
  if (project.id !== projectId || project.ssoProtection?.deploymentType !== "all") {
    throw new Error("Enable Vercel Authentication with All Deployments protection before deploying this personal collection.");
  }
  console.log("Verified Vercel Authentication protects all deployment URLs.");
}

async function main() {
  // Local builds need no cloud account; an explicit check always verifies it.
  if (process.argv.includes("--if-vercel") && process.env.VERCEL !== "1") return;
  await checkDeployment();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Deployment protection check failed.");
    process.exitCode = 1;
  });
}
